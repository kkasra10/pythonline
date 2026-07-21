# 🐍 PythonLine

A browser-based Python IDE that runs **entirely in your browser** — no install, no
server, no account. It works on phones, tablets and laptops.

Powered by [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), so your
code runs locally on your device. `numpy`, `pandas` and `matplotlib` are preloaded, and
you can `pip install` more pure-Python packages on the fly.

## Features (v0 — scrappy first cut)

- ✍️ CodeMirror editor with Python syntax highlighting
- ▶️ Run code with the button or `Ctrl`/`Cmd` + `Enter`
- ⏹️ **Stop** button that hard-kills a runaway program (Python runs in a Web Worker)
- 🛡️ Safety guards: the UI never freezes during long runs, and output is capped so a `while True: print()` can't lock up the tab
- 📦 Preloaded `numpy`, `pandas`, `matplotlib`; install more via the package box
- 📊 Inline matplotlib plots
- 🐢 `turtle` graphics rendered to a canvas (a browser-friendly reimplementation)
- ⌨️ Interactive `input()` — pops up a prompt (or pre-fill answers in the stdin panel)
- 📂 Open a `.py` file, 💾 Save one, and 💿 autosave to the browser (survives refresh)
- 🔗 "Share" copies a link that encodes your code in the URL
- 📱 Responsive layout — panes sit side-by-side on desktop, stacked on mobile
- 💡 Example snippets to get started

## How it runs

`index.html` loads the editor; `worker.js` boots Pyodide in a Web Worker and runs
your code there. Because execution is off the main thread, the page stays
responsive and **Stop** works by terminating the worker and spinning up a fresh
interpreter.

## Run locally

It's a static site — just serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy on GitHub Pages

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**.
3. Pick the branch (e.g. `main`) and `/ (root)` folder.
4. It goes live at `https://<user>.github.io/pythonline/`.

## Roadmap ideas

- Multiple files / tabs
- Persist code to `localStorage`
- Stop / interrupt a running program
- Dark/light theme toggle
- Download output & plots
