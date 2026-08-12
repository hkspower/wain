// Electron shell for the Steam PC build of Gulf Road Nights.
//
// The Next.js static export (out/) uses absolute /_next/... asset paths,
// which break under file://, so we serve it from a tiny local HTTP server
// bound to 127.0.0.1 and point the window at it.

const { app, BrowserWindow, globalShortcut, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "out");

// The Steam overlay injects into the GPU process; Electron needs the GPU
// work in-process for it to hook. Harmless outside Steam.
app.commandLine.appendSwitch("in-process-gpu");
app.commandLine.appendSwitch("disable-direct-composition");

// ---------------------------------------------------------------- steam
// Optional: present in the shipped build, absent in dev. Failing to init
// (no Steam running, missing lib) must never stop the game from opening.
let steam = null;
try {
  // eslint-disable-next-line global-require
  const steamworks = require("steamworks.js");
  const appId = parseInt(
    fs.readFileSync(path.join(__dirname, "steam_appid.txt"), "utf8").trim(),
    10
  );
  steam = steamworks.init(appId);
  console.log(`Steamworks up — logged in as ${steam.localplayer.getName()}`);
} catch {
  console.log("Steamworks not available — running without Steam features.");
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain",
  ".glb": "model/gltf-binary",
};

function resolveFile(urlPath) {
  const clean = path
    .normalize(decodeURIComponent(urlPath.split("?")[0]))
    .replace(/^(\.\.[/\\])+/, "");
  const candidates = [
    path.join(OUT_DIR, clean),
    path.join(OUT_DIR, clean + ".html"),
    path.join(OUT_DIR, clean, "index.html"),
  ];
  for (const c of candidates) {
    // Normalized and re-rooted: nothing outside out/ is ever served
    if (!c.startsWith(OUT_DIR)) continue;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return path.join(OUT_DIR, "404.html");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(req.url === "/" ? "/race" : req.url);
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      // The exported data API lands as extensionless files under
      // out/api/... — serve those as JSON so the Unreal client (and any
      // other consumer) can read them straight from the shell.
      const ext = path.extname(file);
      const type =
        MIME[ext] ||
        (!ext && req.url.startsWith("/api/") ? "application/json; charset=utf-8" : null) ||
        "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        // The UE5 client may run as a separate process on the same box
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: "#05070f",
    title: "Gulf Road Nights — ليالي شارع الخليج",
    webPreferences: {
      // A race must not stutter when the window loses focus
      backgroundThrottling: false,
    },
  });

  const origin = `http://127.0.0.1:${port}`;
  win.loadURL(`${origin}/race`);

  // Stay inside the game: external links (the online hub notice etc.) go
  // to the system browser, and nothing may navigate the shell elsewhere.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Standard PC fullscreen toggles
  const toggle = () => win.setFullScreen(!win.isFullScreen());
  globalShortcut.register("F11", toggle);
  globalShortcut.register("Alt+Enter", toggle);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
