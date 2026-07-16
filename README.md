# 🐍 PythonLine

A browser-based Python IDE that runs **entirely in your browser** — no install, no
server, no account. It works on phones, tablets and laptops.

Powered by [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), so your
code runs locally on your device. `numpy`, `pandas` and `matplotlib` are preloaded, and
you can `pip install` more pure-Python packages on the fly.

## Features (v0 — scrappy first cut)

- ✍️ CodeMirror editor with Python syntax highlighting
- ▶️ Run code with the button or `Ctrl`/`Cmd` + `Enter`
- 📦 Preloaded `numpy`, `pandas`, `matplotlib`; install more via the package box
- 📊 Inline matplotlib plots
- ⌨️ Interactive `input()` support
- 🔗 "Share" copies a link that encodes your code in the URL
- 📱 Responsive layout — panes sit side-by-side on desktop, stacked on mobile
- 💾 Example snippets to get started

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
