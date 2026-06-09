# Gulf Road Nights — Steam PC build

The game itself lives in the web app (`/race` route). This folder wraps the
static export in Electron so it ships as a Windows/Linux/macOS desktop game
on Steam.

## 1. Build the static export

From the repository root:

```bash
npm install
NEXT_OUTPUT=export npm run build   # writes the static site to out/
```

## 2. Run the desktop shell locally

```bash
cd desktop
npm install
cp -r ../out ./out                 # bundle the export next to main.js
npm start                          # launches fullscreen Electron window
```

## 3. Package the desktop build

```bash
npm run dist                       # electron-builder → desktop/dist/
```

This produces an unpacked app directory per platform (`win-unpacked`, etc.),
which is exactly what Steam depots want — no installer needed.

## 4. Steamworks integration

1. Get an App ID from [Steamworks](https://partner.steamgames.com/) (the
   $100 Steam Direct fee applies).
2. Add the native bindings and an `steam_appid.txt` for local testing:

   ```bash
   npm install steamworks.js
   echo YOUR_APP_ID > steam_appid.txt
   ```

3. Initialize in `main.js` (snippet already stubbed there):

   ```js
   const steamworks = require("steamworks.js");
   const client = steamworks.init(YOUR_APP_ID);
   ```

   `steamworks.js` gives you achievements ("King of Gulf Road" 👑),
   rich presence, cloud saves, and the overlay. For the overlay to work,
   launch Electron with `client.overlay` support — see the
   [steamworks.js docs](https://github.com/ceifa/steamworks.js).

4. Upload with `steamcmd` using a depot build script like:

   ```
   "AppBuild"
   {
     "AppID" "YOUR_APP_ID"
     "Desc" "Gulf Road Nights v1.0"
     "ContentRoot" "dist/win-unpacked"
     "BuildOutput" "steam_build_output"
     "Depots" { "YOUR_DEPOT_ID" { "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" } } }
   }
   ```

   then: `steamcmd +login <account> +run_app_build app_build.vdf +quit`

## Progress saves

Game progress (rivals defeated) is stored in `localStorage`, which Electron
persists per-machine automatically. Wire it through `client.cloud` if you
want Steam Cloud sync.
