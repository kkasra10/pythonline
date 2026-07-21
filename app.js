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
function clearOutput() { outputEl.innerHTML = ""; plotsEl.innerHTML = ""; outChars = 0; truncated = false; pendingInputEl = null; }
function showImage(src) {
  const img = new Image();
  img.src = src;
  plotsEl.appendChild(img);
  plotsEl.scrollTop = plotsEl.scrollHeight;
}

/* ---------- Turtle: render recorded drawing commands onto a canvas ---------- */
function showTurtle(json) {
  let data;
  try { data = JSON.parse(json); } catch { return; }
  const evs = data.events || [];

  // Bounding box of everything drawn (fall back to a small default area).
  let minX = 0, minY = 0, maxX = 0, maxY = 0, has = false;
  const see = (x, y) => {
    if (!has) { minX = maxX = x; minY = maxY = y; has = true; }
    else { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  };
  for (const e of evs) {
    if (e.t === "line") { see(e.x1, e.y1); see(e.x2, e.y2); }
    else if (e.t === "dot" || e.t === "text") see(e.x, e.y);
    else if (e.t === "fill") for (const p of e.pts) see(p[0], p[1]);
  }
  if (!has) { minX = -10; minY = -10; maxX = 10; maxY = 10; }

  const pad = 16;
  const cssW = Math.min(plotsEl.clientWidth - 12 || 468, 480);
  const cssH = Math.round(cssW * 0.72);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.display = "block";
  canvas.style.margin = "8px auto";
  canvas.style.background = data.bg || "#ffffff";
  canvas.style.borderRadius = "6px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Uniform fit so proportions are preserved and the whole drawing is visible.
  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
  const scale = Math.min((cssW - 2 * pad) / bw, (cssH - 2 * pad) / bh);
  const offX = (cssW - bw * scale) / 2;
  const offY = (cssH - bh * scale) / 2;
  const TX = (x) => offX + (x - minX) * scale;
  const TY = (y) => cssH - (offY + (y - minY) * scale);  // flip Y (turtle is y-up)

  // Fills first, so outlines drawn later stay visible on top.
  for (const e of evs) {
    if (e.t !== "fill") continue;
    ctx.beginPath();
    e.pts.forEach((p, i) => (i ? ctx.lineTo(TX(p[0]), TY(p[1])) : ctx.moveTo(TX(p[0]), TY(p[1]))));
    ctx.closePath();
    ctx.fillStyle = e.c;
    ctx.fill();
  }
  for (const e of evs) {
    if (e.t === "line") {
      ctx.beginPath();
      ctx.moveTo(TX(e.x1), TY(e.y1));
      ctx.lineTo(TX(e.x2), TY(e.y2));
      ctx.strokeStyle = e.c;
      ctx.lineWidth = Math.max(e.w, 1);
      ctx.lineCap = "round";
      ctx.stroke();
    } else if (e.t === "dot") {
      ctx.beginPath();
      ctx.arc(TX(e.x), TY(e.y), Math.max(e.s / 2, 1), 0, 2 * Math.PI);
      ctx.fillStyle = e.c;
      ctx.fill();
    } else if (e.t === "text") {
      ctx.fillStyle = e.c;
      ctx.font = (e.size || 12) + "px sans-serif";
      ctx.textAlign = e.align || "left";
      ctx.fillText(e.s, TX(e.x), TY(e.y));
    }
  }

  plotsEl.appendChild(canvas);
  plotsEl.scrollTop = plotsEl.scrollHeight;
}

/* ---------- Inline terminal-style input() prompt ---------- */
let pendingInputEl = null;
function askInline(promptText) {
  const label = promptText || "";
  const row = document.createElement("div");
  row.className = "inrow";

  const lbl = document.createElement("span");
  lbl.className = "inrow-prompt";
  lbl.textContent = label;

  const field = document.createElement("input");
  field.className = "inrow-field";
  field.type = "text";
  field.autocapitalize = "off";
  field.autocomplete = "off";
  field.spellcheck = false;

  row.appendChild(lbl);
  row.appendChild(field);
  outputEl.appendChild(row);
  outputEl.scrollTop = outputEl.scrollHeight;
  pendingInputEl = row;
  field.focus();

  const submit = () => {
    const value = field.value;
    row.remove();
    pendingInputEl = null;
    write(label, "sys");        // echo the prompt…
    write(value + "\n", "in");  // …and what was typed, terminal-style
    if (worker) worker.postMessage({ type: "input-response", value });
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
}
function clearPendingInput() {
  if (pendingInputEl) { pendingInputEl.remove(); pendingInputEl = null; }
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
          write("Install more with the box above. input() will pop up a prompt (or pre-fill the stdin panel).\n\n", "sys");
        }
        break;
      case "stdout": write(m.text); break;
      case "stderr": write(m.text, "err"); break;
      case "plot": showImage(m.src); break;
      case "turtle": showTurtle(m.data); break;
      case "input": askInline(m.prompt); break;
      case "done":
        if (m.error) write(m.error.endsWith("\n") ? m.error : m.error + "\n", "err");
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
  clearPendingInput();
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
  turtle: `import turtle\n\nt = turtle.Turtle()\ncolors = ["red", "orange", "gold", "green", "blue", "purple"]\n\nt.width(2)\nfor i in range(60):\n    t.pencolor(colors[i % len(colors)])\n    t.forward(i * 4)\n    t.left(59)\n\nt.hideturtle()\nturtle.done()`,
  input: `# Run this: input() pops up a prompt asking for each value.\n# (Or pre-fill answers in the stdin panel, one per line, to skip the prompts.)\nname = input("What is your name? ")\nprint("Hello,", name + "!")`,
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
