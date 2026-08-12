# Gulf Road Nights — Steam PC build

The game itself lives in the web app (`/race` route). This folder wraps the
static export in Electron so it ships as a Windows/Linux/macOS desktop game
on Steam.

## 1. Build the static export

From the repository root:

```bash
npm install
npm run build:steam    # static export → out/ and copies it into desktop/out
```

## 2. Run the desktop shell locally

```bash
cd desktop
npm install
npm start                          # launches fullscreen Electron window
```

`F11` / `Alt+Enter` toggle fullscreen. External links open in the system
browser; the shell never navigates away from the game. Background
throttling is off so the race keeps running when the window loses focus,
and the Steam-overlay GPU flags are already set.

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

   Ready-made templates live in `desktop/steam/app_build.vdf` (Windows +
   Linux depots, App ID 480 = Spacewar for testing). Upload with:

   ```bash
   steamcmd +login <builder_account> +run_app_build desktop/steam/app_build.vdf +quit
   ```

## 5. Store page asset checklist

Steam requires these before the page goes live (all PNG or JPG):

| Asset | Size | Notes |
| --- | --- | --- |
| Header capsule | 460×215 | Store search + library grid small |
| Small capsule | 231×87 | Lists and recommendations |
| Main capsule | 616×353 | Front-page features |
| Vertical capsule | 374×448 | Top sellers rail |
| Library capsule | 600×900 | Library grid |
| Library hero | 3840×1240 | Library detail banner |
| Library logo | 1280×720 transparent | Overlays the hero |
| Screenshots | 1920×1080, min 5 | Night shots of battles, drifts, the cinematic |
| Client icon | 32×32 .ico + 184×184 community | |

Suggested copy: "Tokyo-style midnight highway battles on Kuwait's real
Gulf Road. Flash your headlights, stake your money, drain their spirit."
Tags: Racing, Arcade, Drift, Multiplayer. The launch options need no
arguments — the shell boots straight into the game.

## Progress saves

Game progress (rivals defeated) is stored in `localStorage`, which Electron
persists per-machine automatically. Wire it through `client.cloud` if you
want Steam Cloud sync.
