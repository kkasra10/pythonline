/* PythonLine — a browser Python IDE.
   Python runs in a Web Worker (see worker.js), so the page never freezes and
   Stop can hard-kill a runaway program. */

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const outputEl = $("output");
const plotsEl = $("plots");
const runBtn = $("run");
const stopBtn = $("stop");

let worker = null;
let ready = false;
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

/* ---------- Output (with a flood guard so runaway prints can't lock up the tab) ---------- */
const MAX_OUT_CHARS = 400000;
let outChars = 0;
let truncated = false;

function write(text, cls) {
  if (truncated) return;
  if (outChars + text.length > MAX_OUT_CHARS) {
    truncated = true;
    const span = document.createElement("span");
    span.className = "sys";
    span.textContent = "\n[output truncated — press Clear to reset]\n";
    outputEl.appendChild(span);
    return;
  }
  outChars += text.length;
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
}
function setStatus(t) { statusEl.textContent = t; }
function clearOutput() { outputEl.innerHTML = ""; plotsEl.innerHTML = ""; outChars = 0; truncated = false; }
function showImage(src) {
  const img = new Image();
  img.src = src;
  plotsEl.appendChild(img);
  plotsEl.scrollTop = plotsEl.scrollHeight;
}

/* ---------- Run/Stop button state ---------- */
function setBusy(b) {
  running = b;
  runBtn.disabled = b || !ready;
  stopBtn.disabled = !b;
  runBtn.style.display = b ? "none" : "";
  stopBtn.style.display = b ? "" : "none";
}

/* ---------- Worker lifecycle ---------- */
function startWorker(initial) {
  worker = new Worker("worker.js");
  worker.onmessage = (e) => {
    const m = e.data;
    switch (m.type) {
      case "status": setStatus(m.text); break;
      case "ready":
        ready = true;
        setStatus("ready");
        runBtn.disabled = false;
        if (initial) {
          write("PythonLine ready. numpy, pandas & matplotlib are preloaded.\n", "sys");
          write("Install more with the box above. For input(), type values in the stdin panel.\n\n", "sys");
        }
        break;
      case "stdout": write(m.text); break;
      case "stderr": write(m.text, "err"); break;
      case "plot": showImage(m.src); break;
      case "done":
        if (m.error) write(m.error + "\n", "err");
        setBusy(false);
        setStatus("ready");
        break;
      case "installed": write("Installed " + m.name + ".\n", "sys"); setStatus("ready"); break;
      case "install-failed": write("Could not install " + m.name + ": " + m.error + "\n", "err"); setStatus("ready"); break;
    }
  };
  worker.onerror = (e) => { write("Worker error: " + e.message + "\n", "err"); setBusy(false); };
  worker.postMessage({ type: "init" });
}

/* ---------- Run / Stop ---------- */
function runCode() {
  if (!ready || running) return;
  setBusy(true);
  setStatus("running…");
  plotsEl.innerHTML = "";
  write("\n>>> run\n", "in");
  worker.postMessage({ type: "run", code: editor.getValue(), stdin: $("stdin").value });
}

function stopCode() {
  if (!running) return;
  worker.terminate();          // hard-kill any runaway loop
  write("\n[stopped]\n", "sys");
  ready = false;
  running = false;
  runBtn.disabled = true;
  stopBtn.disabled = true;
  stopBtn.style.display = "none";
  runBtn.style.display = "";
  setStatus("restarting python…");
  startWorker(false);          // respawn a fresh interpreter
}

/* ---------- Package installer ---------- */
function installPkg() {
  const name = $("pkg-name").value.trim();
  if (!name || !ready || running) return;
  worker.postMessage({ type: "install", name });
  $("pkg-name").value = "";
}

/* ---------- Examples ---------- */
const EXAMPLES = {
  hello: `print("Hello from Python in the browser!")\nfor i in range(5):\n    print("count", i)`,
  numpy: `import numpy as np\n\na = np.arange(12).reshape(3, 4)\nprint(a)\nprint("mean:", a.mean())\nprint("sum axis0:", a.sum(axis=0))`,
  pandas: `import pandas as pd\n\ndf = pd.DataFrame({\n    "name": ["Ada", "Alan", "Grace"],\n    "score": [91, 88, 95],\n})\nprint(df)\nprint("\\naverage score:", df.score.mean())`,
  plot: `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 2 * np.pi, 200)\nplt.plot(x, np.sin(x), label="sin")\nplt.plot(x, np.cos(x), label="cos")\nplt.legend()\nplt.title("Trig functions")\nplt.show()`,
  input: `# Type a name into the stdin panel (below "Output"), then press Run.\nname = input("What is your name? ")\nprint("Hello,", name + "!")`,
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

/* ---------- Autosave to the browser (localStorage) ---------- */
const STORAGE_KEY = "pythonline.code";
let saveTimer = null;
editor.on("change", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, editor.getValue()); } catch {}
  }, 400);
});
function loadFromStorage() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/* ---------- Open a .py file from disk ---------- */
function openFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    editor.setValue(String(reader.result));
    setStatus("opened " + file.name);
    setTimeout(() => setStatus("ready"), 1500);
  };
  reader.readAsText(file);
}
$("open").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) openFile(file);
  e.target.value = "";
});

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
stopBtn.addEventListener("click", stopCode);
$("clear").addEventListener("click", clearOutput);
$("share").addEventListener("click", share);
$("save").addEventListener("click", saveFile);
$("pkg-install").addEventListener("click", installPkg);
$("pkg-name").addEventListener("keydown", (e) => { if (e.key === "Enter") installPkg(); });

editor.setValue(loadFromUrl() || loadFromStorage() || EXAMPLES.hello);
setStatus("booting…");
startWorker(true);
