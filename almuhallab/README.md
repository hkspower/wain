# Almuhallab Code

A fast, **offline, in-browser code editor** — write HTML, CSS, and JavaScript
and see a live preview instantly. Single self-contained file, no build step, no
dependencies.

## Run it

Just open `index.html` in any browser:

```bash
open almuhallab/index.html      # macOS
xdg-open almuhallab/index.html  # Linux
```

Or serve the folder:

```bash
npx serve almuhallab
```

## Features

- **Three editors** — `index.html`, `style.css`, `script.js` with line numbers
- **Live preview** — updates as you type (toggle **Auto-run**, or press **▶ Run** / **Ctrl/Cmd+S**)
- **Runs safely** in a sandboxed `<iframe>`; runtime errors are shown in the preview
- **Auto-saves** your code to the browser's local storage
- **Copy** the combined HTML or **Download** it as a standalone `.html` file
- **Tab** inserts two spaces; **Reset** restores the starter example
- Responsive — panes stack on narrow screens
