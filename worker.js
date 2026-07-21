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
    _state["code"] = compile(code, "main.py", "exec")
    _t_reset_all()   # clear any turtle drawing from the previous try

def _execute():
    import sys, traceback
    _state["idx"] = 0
    try:
        exec(_state["code"], _state["globals"])
        return ["done", ""]                 # completed
    except _NeedInput as e:
        return ["input", str(e.prompt)]     # needs another answer
    except SystemExit:
        return ["done", ""]
    except BaseException:
        etype, evalue, tb = sys.exc_info()
        # Drop our own exec frame so the traceback starts at the user's code.
        clean = tb.tb_next if tb is not None else None
        return ["error", "".join(traceback.format_exception(etype, evalue, clean))]

def _show(*a, **k):
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        js.pyShowImage("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
    plt.close("all")

plt.show = _show

# ---- turtle: record drawing here, render to a <canvas> on the page ----
import sys as _sys, math as _tmath, json as _tjson, types as _ttypes

_TURTLE = {"events": [], "bg": None, "w": 480, "h": 360}

def _to_color(a):
    if len(a) == 1:
        c = a[0]
        if isinstance(c, str):
            return c
        try:
            r, g, b = c
        except Exception:
            return str(c)
    else:
        r, g, b = a[0], a[1], a[2]
    if max(r, g, b) <= 1:
        r, g, b = r * 255, g * 255, b * 255
    return "rgb(%d,%d,%d)" % (int(r), int(g), int(b))

class _Turtle:
    def __init__(self, *a, **k): self._reset()
    def _reset(self):
        self.x = 0.0; self.y = 0.0; self.h = 0.0
        self._pen = True; self._color = "black"; self._size = 1.0
        self._visible = True; self._fillcolor = "black"; self._fillpts = None
    def _emit(self, ev): _TURTLE["events"].append(ev)
    def _lineto(self, nx, ny):
        nx = float(nx); ny = float(ny)
        if self._pen:
            self._emit({"t":"line","x1":self.x,"y1":self.y,"x2":nx,"y2":ny,"c":self._color,"w":self._size})
        if self._fillpts is not None:
            self._fillpts.append([nx, ny])
        self.x = nx; self.y = ny
    def forward(self, d):
        r = _tmath.radians(self.h)
        self._lineto(self.x + d*_tmath.cos(r), self.y + d*_tmath.sin(r))
    fd = forward
    def backward(self, d): self.forward(-d)
    bk = backward; back = backward
    def right(self, a): self.h -= a
    rt = right
    def left(self, a): self.h += a
    lt = left
    def setheading(self, a): self.h = a
    seth = setheading
    def goto(self, x, y=None):
        if y is None:
            try: x, y = x
            except Exception: pass
        self._lineto(x, y)
    setpos = goto; setposition = goto
    def setx(self, x): self._lineto(x, self.y)
    def sety(self, y): self._lineto(self.x, y)
    def home(self): self._lineto(0.0, 0.0); self.h = 0.0
    def penup(self): self._pen = False
    pu = penup; up = penup
    def pendown(self): self._pen = True
    pd = pendown; down = pendown
    def isdown(self): return self._pen
    def pensize(self, w=None):
        if w is None: return self._size
        self._size = w
    width = pensize
    def pencolor(self, *a):
        if not a: return self._color
        self._color = _to_color(a)
    def fillcolor(self, *a):
        if not a: return self._fillcolor
        self._fillcolor = _to_color(a)
    def color(self, *a):
        if not a: return (self._color, self._fillcolor)
        if len(a) >= 2 and isinstance(a[0], str) and isinstance(a[1], str):
            self._color = a[0]; self._fillcolor = a[1]
        else:
            c = _to_color(a); self._color = c; self._fillcolor = c
    def dot(self, size=None, *color):
        s = size if size else max(self._size + 4, self._size * 2)
        c = _to_color(color) if color else self._color
        self._emit({"t":"dot","x":self.x,"y":self.y,"s":s,"c":c})
    def circle(self, radius, extent=None, steps=None):
        if extent is None: extent = 360
        if steps is None:
            frac = abs(extent) / 360.0
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = extent / steps; w2 = 0.5 * w
        l = 2.0 * radius * _tmath.sin(_tmath.radians(w2))
        if radius < 0: l, w, w2 = -l, -w, -w2
        self.left(w2)
        for _ in range(steps):
            self.forward(l); self.left(w)
        self.left(-w2)
    def begin_fill(self): self._fillpts = [[self.x, self.y]]
    def end_fill(self):
        if self._fillpts and len(self._fillpts) >= 3:
            self._emit({"t":"fill","pts":self._fillpts,"c":self._fillcolor})
        self._fillpts = None
    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        sz = font[1] if isinstance(font, (list, tuple)) and len(font) > 1 else 12
        self._emit({"t":"text","x":self.x,"y":self.y,"s":str(arg),"c":self._color,"size":sz,"align":align})
    def speed(self, *a): return None
    def hideturtle(self): self._visible = False
    ht = hideturtle
    def showturtle(self): self._visible = True
    st = showturtle
    def isvisible(self): return self._visible
    def position(self): return (self.x, self.y)
    pos = position
    def xcor(self): return self.x
    def ycor(self): return self.y
    def heading(self): return self.h
    def towards(self, x, y=None):
        if y is None: x, y = x
        return _tmath.degrees(_tmath.atan2(y - self.y, x - self.x))
    def clear(self): _TURTLE["events"] = []
    def reset(self): _TURTLE["events"] = []; self._reset()
    def stamp(self): return None
    def setundobuffer(self, *a): return None
    def getscreen(self): return _screen

_default = _Turtle()

def _t_reset_all():
    _TURTLE["events"] = []; _TURTLE["bg"] = None
    _default._reset()

def _turtle_events():
    if not _TURTLE["events"] and not _TURTLE["bg"]:
        return ""
    return _tjson.dumps(_TURTLE)

def _bgcolor(*a):
    if not a: return _TURTLE["bg"]
    _TURTLE["bg"] = _to_color(a)

class _Screen:
    def bgcolor(self, *a): return _bgcolor(*a)
    def setup(self, width=None, height=None, *a, **k):
        if width: _TURTLE["w"] = int(width)
        if height: _TURTLE["h"] = int(height)
    def screensize(self, w=None, h=None, *a, **k):
        if w: _TURTLE["w"] = int(w)
        if h: _TURTLE["h"] = int(h)
    def _noop(self, *a, **k): return None
    title = _noop; tracer = _noop; update = _noop; exitonclick = _noop
    mainloop = _noop; done = _noop; bye = _noop; colormode = _noop
    listen = _noop; onkey = _noop; onkeypress = _noop; onclick = _noop
    delay = _noop; setworldcoordinates = _noop
    def window_width(self): return _TURTLE["w"]
    def window_height(self): return _TURTLE["h"]

_screen = _Screen()

_turtle_mod = _ttypes.ModuleType("turtle")
_turtle_mod.Turtle = _Turtle
_turtle_mod.Pen = _Turtle
_turtle_mod.RawTurtle = _Turtle
_turtle_mod.Screen = lambda: _screen
_turtle_mod.getscreen = lambda *a: _screen
_turtle_mod.bgcolor = _bgcolor
_turtle_mod.mainloop = _screen.mainloop
_turtle_mod.done = _screen.done
_turtle_mod.exitonclick = _screen.exitonclick
_turtle_mod.bye = _screen.bye
_turtle_mod.update = _screen.update
_turtle_mod.tracer = _screen.tracer
_turtle_mod.delay = _screen.delay
_turtle_mod.title = _screen.title
_turtle_mod.colormode = _screen.colormode
_turtle_mod.listen = _screen.listen
_turtle_mod.onkey = _screen.onkey
_turtle_mod.onkeypress = _screen.onkeypress
_turtle_mod.onclick = _screen.onclick
_turtle_mod.setup = _screen.setup
_turtle_mod.screensize = _screen.screensize
_turtle_mod.setworldcoordinates = _screen.setworldcoordinates

for _n in ["forward","fd","backward","bk","back","right","rt","left","lt",
           "goto","setpos","setposition","setx","sety","setheading","seth",
           "home","penup","pu","up","pendown","pd","down","isdown","pensize",
           "width","pencolor","fillcolor","color","dot","circle","begin_fill",
           "end_fill","write","speed","hideturtle","ht","showturtle","st",
           "isvisible","position","pos","xcor","ycor","heading","towards",
           "clear","reset","stamp"]:
    setattr(_turtle_mod, _n, getattr(_default, _n))

_sys.modules["turtle"] = _turtle_mod

# ---- pygame: not supported in the browser; fail with a clear message ----
_pygame_mod = _ttypes.ModuleType("pygame")
def _pg_getattr(name):
    raise RuntimeError(
        "pygame isn't available in PythonLine: it needs SDL, which can't run "
        "in the browser sandbox. For graphics, use turtle (fully supported here)."
    )
_pygame_mod.__getattr__ = _pg_getattr
_sys.modules["pygame"] = _pygame_mod
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

  try {
    while (true) {
      buffer = [];                     // discard any partial output from the last try
      prepare(code, answers);
      const res = execute();           // ["done"|"input"|"error", payload]
      const [status, payload] = res.toJs();
      res.destroy();

      if (status === "done" || status === "error") {
        flush();
        const getT = pyodide.globals.get("_turtle_events");
        const tj = getT(); getT.destroy();
        if (tj) post("turtle", { data: tj });
        post("done", status === "error" ? { error: payload } : {});
        return;
      }

      // status === "input": ask the page and re-run with the answer added.
      const answer = await askPage(String(payload));
      answers.push(answer);
    }
  } finally {
    prepare.destroy();
    execute.destroy();
  }
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
