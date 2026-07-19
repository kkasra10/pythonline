/* PythonLine execution worker — runs Pyodide off the main thread so the UI
   stays responsive and a runaway program can be killed by terminating me.

   input() is interactive: when the program asks for input we don't have yet,
   we ask the page, then re-run the script with the collected answers. Output
   from these intermediate runs is buffered and discarded, so the user only
   ever sees one clean run. Pre-filled stdin lines are used first, so a fully
   pre-filled program runs exactly once with no prompts. */

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

let pyodide = null;
let buffer = [];          // captured output for the current (maybe discarded) run
let inputResolve = null;  // resolves when the page sends an input answer

const post = (type, data = {}) => self.postMessage({ type, ...data });

// Pyodide writes here; we hold it until we know the run is final.
function boot_io() {
  return {
    stdout: (s) => buffer.push({ k: "out", t: s + "\n" }),
    stderr: (s) => buffer.push({ k: "err", t: s + "\n" }),
  };
}
self.pyShowImage = (src) => buffer.push({ k: "plot", s: src });

function flush() {
  for (const item of buffer) {
    if (item.k === "out") post("stdout", { text: item.t });
    else if (item.k === "err") post("stderr", { text: item.t });
    else if (item.k === "plot") post("plot", { src: item.s });
  }
  buffer = [];
}

function askPage(prompt) {
  return new Promise((resolve) => {
    inputResolve = resolve;
    post("input", { prompt });
  });
}

async function boot() {
  try {
    post("status", { text: "loading python…" });
    const io = boot_io();
    pyodide = await loadPyodide({ stdout: io.stdout, stderr: io.stderr });

    post("status", { text: "loading libraries…" });
    await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "micropip"]);

    // Interactive-input plumbing + matplotlib -> in-page image.
    await pyodide.runPythonAsync(`
import builtins, matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt, io, base64, js

class _NeedInput(Exception):
    def __init__(self, prompt): self.prompt = prompt

_state = {"answers": [], "idx": 0, "globals": {}, "code": ""}

def _input(prompt=""):
    s = _state
    if s["idx"] < len(s["answers"]):
        v = s["answers"][s["idx"]]; s["idx"] += 1
        return v
    raise _NeedInput(str(prompt))

builtins.input = _input

def _prepare(code, answers):
    _state["answers"] = [str(a) for a in answers]
    _state["idx"] = 0
    _state["globals"] = {"__name__": "__main__", "__builtins__": builtins}
    _state["code"] = code

def _execute():
    _state["idx"] = 0
    try:
        exec(_state["code"], _state["globals"])
        return None                 # completed
    except _NeedInput as e:
        return e.prompt             # needs another answer

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
    flush();
  }
}

async function run(code, stdinText) {
  // Pre-fill answers from the stdin panel (used before we prompt interactively).
  const seed = stdinText === "" ? [] : stdinText.replace(/\n$/, "").split("\n");
  const answers = seed.slice();

  try {
    await pyodide.loadPackagesFromImports(code);
  } catch (e) { /* import auto-load is best-effort */ }

  const prepare = pyodide.globals.get("_prepare");
  const execute = pyodide.globals.get("_execute");

  while (true) {
    buffer = [];                       // discard any partial output from the last try
    prepare(code, answers);
    let prompt;
    try {
      prompt = execute();              // null => done, string => needs input
    } catch (e) {
      // A real Python error (traceback) — show it and stop.
      flush();
      post("done", { error: String((e && e.message) || e) });
      cleanup(prepare, execute);
      return;
    }
    if (prompt === null || prompt === undefined) {
      flush();                         // final, complete run
      post("done");
      cleanup(prepare, execute);
      return;
    }
    // Need one more answer: ask the page and re-run.
    const answer = await askPage(String(prompt));
    answers.push(answer);
  }
}

function cleanup(prepare, execute) {
  prepare.destroy();
  execute.destroy();
}

async function install(name) {
  post("status", { text: "installing " + name + "…" });
  buffer.push({ k: "out", t: "\n$ pip install " + name + "\n" });
  try {
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(name);
    flush();
    post("installed", { name });
  } catch (e) {
    try {
      await pyodide.loadPackage(name);
      flush();
      post("installed", { name });
    } catch (e2) {
      flush();
      post("install-failed", { name, error: String((e2 && e2.message) || e2) });
    }
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") boot();
  else if (m.type === "run") run(m.code, m.stdin);
  else if (m.type === "install") install(m.name);
  else if (m.type === "input-response") {
    if (inputResolve) { inputResolve(m.value); inputResolve = null; }
  }
};
