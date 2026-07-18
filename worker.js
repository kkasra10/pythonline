/* PythonLine execution worker — runs Pyodide off the main thread so the UI
   stays responsive and a runaway program can be killed by terminating me. */

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

let pyodide = null;
let stdinLines = [];
let stdinPos = 0;

const post = (type, data = {}) => self.postMessage({ type, ...data });

// Called from Python (via the `js` proxy) to hand a rendered plot to the page.
self.pyShowImage = (src) => post("plot", { src });

// input() pulls the next line from the stdin panel; empty => EOF.
function readLine() {
  return stdinPos < stdinLines.length ? stdinLines[stdinPos++] : "";
}

async function boot() {
  try {
    post("status", { text: "loading python…" });
    pyodide = await loadPyodide({
      stdout: (s) => post("stdout", { text: s + "\n" }),
      stderr: (s) => post("stderr", { text: s + "\n" }),
      stdin: () => readLine(),
    });

    post("status", { text: "loading libraries…" });
    await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "micropip"]);

    // Route matplotlib to an in-page image instead of a native window.
    await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt, io, base64, js

def _show(*a, **k):
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        js.pyShowImage("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
    plt.close("all")

plt.show = _show
`);

    post("ready");
  } catch (e) {
    post("status", { text: "failed to load" });
    post("stderr", { text: "Failed to initialise Python runtime:\n" + e + "\n" });
  }
}

async function run(code, stdinText) {
  stdinLines = stdinText ? stdinText.split("\n") : [];
  stdinPos = 0;
  try {
    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
    post("done");
  } catch (e) {
    post("done", { error: String((e && e.message) || e) });
  }
}

async function install(name) {
  post("status", { text: "installing " + name + "…" });
  post("stdout", { text: "\n$ pip install " + name + "\n" });
  try {
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(name);
    post("installed", { name });
  } catch (e) {
    // Fall back to Pyodide's own repo for compiled packages.
    try {
      await pyodide.loadPackage(name);
      post("installed", { name });
    } catch (e2) {
      post("install-failed", { name, error: String((e2 && e2.message) || e2) });
    }
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") boot();
  else if (m.type === "run") run(m.code, m.stdin);
  else if (m.type === "install") install(m.name);
};
