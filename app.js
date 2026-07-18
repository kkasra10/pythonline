/* PythonLine — a browser Python IDE powered by Pyodide (CPython in WebAssembly). */

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const outputEl = $("output");
const plotsEl = $("plots");
const runBtn = $("run");

let pyodide = null;
let running = false;

/* ---------- Editor ---------- */
const editor = CodeMirror.fromTextArea($("code"), {
  mode: "python",
  theme: "material-darker",
  lineNumbers: true,
  indentUnit: 4,
  matchBrackets: true,
  autoCloseBrackets: true,
  extraKeys: {
    "Ctrl-Enter": runCode,
    "Cmd-Enter": runCode,
    Tab: (cm) => cm.replaceSelection("    "),
  },
});

/* ---------- Output helpers ---------- */
function write(text, cls) {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
}
function setStatus(t) { statusEl.textContent = t; }

/* ---------- Boot Pyodide ---------- */
async function boot() {
  try {
    setStatus("loading python…");
    pyodide = await loadPyodide({
      stdout: (s) => write(s + "\n"),
      stderr: (s) => write(s + "\n", "err"),
      stdin: () => window.prompt("input():") ?? "",
    });

    setStatus("loading libraries…");
    // A "decent battery" of common libraries, ready out of the box.
    await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "micropip"]);

    // Route matplotlib to an in-browser image instead of a native window.
    await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt, io, base64, js

def _show(*args, **kwargs):
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        b64 = base64.b64encode(buf.getvalue()).decode()
        js.pyShowImage("data:image/png;base64," + b64)
    plt.close("all")

plt.show = _show
`);

    setStatus("ready");
    runBtn.disabled = false;
    write("PythonLine ready. numpy, pandas & matplotlib are preloaded.\n", "sys");
    write("Install more with the box above, e.g. requests, sympy, scipy.\n\n", "sys");
  } catch (e) {
    setStatus("failed to load");
    write("Failed to initialise Python runtime:\n" + e + "\n", "err");
  }
}

// Called from Python to render a matplotlib figure.
window.pyShowImage = (src) => {
  const img = new Image();
  img.src = src;
  plotsEl.appendChild(img);
  plotsEl.scrollTop = plotsEl.scrollHeight;
};

/* ---------- Run ---------- */
async function runCode() {
  if (!pyodide || running) return;
  running = true;
  runBtn.disabled = true;
  setStatus("running…");
  plotsEl.innerHTML = "";
  write("\n>>> run\n", "in");

  const code = editor.getValue();
  try {
    // Auto-load any packages the code imports (numpy, etc. if not already present).
    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
  } catch (e) {
    write(String(e.message || e) + "\n", "err");
  } finally {
    running = false;
    runBtn.disabled = false;
    setStatus("ready");
  }
}

/* ---------- Package installer ---------- */
async function installPkg() {
  const name = $("pkg-name").value.trim();
  if (!name || !pyodide) return;
  setStatus("installing " + name + "…");
  write(`\n$ pip install ${name}\n`, "in");
  try {
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(name);
    write(`Installed ${name}.\n`, "sys");
  } catch (e) {
    // Fall back to Pyodide's own package repo for compiled packages.
    try {
      await pyodide.loadPackage(name);
      write(`Installed ${name}.\n`, "sys");
    } catch (e2) {
      write(`Could not install ${name}: ${e2.message || e2}\n`, "err");
    }
  }
  setStatus("ready");
  $("pkg-name").value = "";
}

/* ---------- Examples ---------- */
const EXAMPLES = {
  hello: `print("Hello from Python in the browser!")\nfor i in range(5):\n    print("count", i)`,
  numpy: `import numpy as np\n\na = np.arange(12).reshape(3, 4)\nprint(a)\nprint("mean:", a.mean())\nprint("sum axis0:", a.sum(axis=0))`,
  pandas: `import pandas as pd\n\ndf = pd.DataFrame({\n    "name": ["Ada", "Alan", "Grace"],\n    "score": [91, 88, 95],\n})\nprint(df)\nprint("\\naverage score:", df.score.mean())`,
  plot: `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 2 * np.pi, 200)\nplt.plot(x, np.sin(x), label="sin")\nplt.plot(x, np.cos(x), label="cos")\nplt.legend()\nplt.title("Trig functions")\nplt.show()`,
  input: `name = input("What is your name? ")\nprint("Hello,", name + "!")`,
};

$("examples").addEventListener("change", (e) => {
  const key = e.target.value;
  if (key && EXAMPLES[key]) editor.setValue(EXAMPLES[key]);
  e.target.value = "";
  editor.focus();
});

/* ---------- Share via URL ---------- */
function share() {
  const encoded = btoa(unescape(encodeURIComponent(editor.getValue())));
  const url = `${location.origin}${location.pathname}#code=${encoded}`;
  navigator.clipboard?.writeText(url).then(
    () => setStatus("link copied!"),
    () => prompt("Copy this link:", url)
  );
  setTimeout(() => setStatus("ready"), 1500);
}

/* ---------- Save code as a .py file ---------- */
function saveFile() {
  const name = (window.prompt("Save as:", "main.py") || "").trim();
  if (!name) return;
  const filename = name.endsWith(".py") ? name : name + ".py";
  const blob = new Blob([editor.getValue()], { type: "text/x-python" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("saved " + filename);
  setTimeout(() => setStatus("ready"), 1500);
}

function loadFromUrl() {
  const m = location.hash.match(/code=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(escape(atob(m[1]))); } catch { return null; }
  }
  return null;
}

/* ---------- Desktop drag-to-resize ---------- */
(function resizer() {
  const divider = $("divider");
  const workspace = document.querySelector(".workspace");
  const left = document.querySelector(".editor-pane");
  let dragging = false;
  divider.addEventListener("mousedown", () => { dragging = true; document.body.style.userSelect = "none"; });
  window.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct > 15 && pct < 85) left.style.flex = `1 1 ${pct}%`;
  });
})();

/* ---------- Wire up ---------- */
runBtn.addEventListener("click", runCode);
$("clear").addEventListener("click", () => { outputEl.innerHTML = ""; plotsEl.innerHTML = ""; });
$("save").addEventListener("click", saveFile);
$("share").addEventListener("click", share);
$("pkg-install").addEventListener("click", installPkg);
$("pkg-name").addEventListener("keydown", (e) => { if (e.key === "Enter") installPkg(); });

editor.setValue(loadFromUrl() || EXAMPLES.hello);
boot();
