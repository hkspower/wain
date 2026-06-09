// Electron shell for the Steam PC build of Gulf Road Nights.
//
// The Next.js static export (out/) uses absolute /_next/... asset paths,
// which break under file://, so we serve it from a tiny local HTTP server
// bound to 127.0.0.1 and point the window at it.

const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "out");

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
  ".txt": "text/plain",
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\.\./g, "");
  const candidates = [
    path.join(OUT_DIR, clean),
    path.join(OUT_DIR, clean + ".html"),
    path.join(OUT_DIR, clean, "index.html"),
  ];
  for (const c of candidates) {
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
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

// Steamworks integration (optional in dev — required for the Steam build):
//   npm install steamworks.js
//   const steamworks = require("steamworks.js");
//   const client = steamworks.init(YOUR_APP_ID);
// Then use client.achievement / client.overlay etc. See desktop/README.md.

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: "#05070f",
    title: "Gulf Road Nights — ليالي شارع الخليج",
  });
  win.loadURL(`http://127.0.0.1:${port}/race`);
});

app.on("window-all-closed", () => app.quit());
