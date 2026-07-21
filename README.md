# Wain? — وين؟ (Native App)

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A full **native mobile app** for iPhone and Android (with web support as a bonus), built with Expo and React Native. Curated landmarks, food, beaches, shopping, culture, and family spots across Kuwait — each with highlights, the best time to visit, and a price level.

## Tech stack

- [Expo SDK 57](https://expo.dev) + [React Native](https://reactnative.dev) (TypeScript)
- [Expo Router](https://docs.expo.dev/router/introduction/) — file-based navigation with native tabs and stack
- Light & dark mode, English & Arabic content
- Fully offline — no database or API keys needed to run

## Getting started

```bash
npm install
npm start
```

Then:

- Press **i** for the iOS simulator, **a** for Android, or **w** for web
- Or scan the QR code with the [Expo Go](https://expo.dev/go) app on your phone

## Project structure

```
src/
├── app/
│   ├── _layout.tsx           # Root stack (tabs + detail + about)
│   ├── (tabs)/
│   │   ├── _layout.tsx       # Native bottom tabs (Home, Explore)
│   │   ├── index.tsx         # Home — hero, categories, featured
│   │   └── explore.tsx       # Search + category filters
│   ├── place/[slug].tsx      # Place detail screen
│   └── about.tsx             # About Wain
├── components/
│   ├── app-tabs.tsx          # Native tabs (iOS/Android)
│   ├── app-tabs.web.tsx      # Web tab bar
│   ├── place-card.tsx
│   ├── category-pill.tsx
│   ├── themed-text.tsx
│   └── themed-view.tsx
├── constants/theme.ts        # Wain colors (light/dark), spacing, fonts
├── hooks/                    # Color-scheme + theme hooks
└── lib/places.ts             # Place data, categories, and helpers
```

## Adding a place

Two ways:

- **In the app** — open the **Admin panel** (see below) and tap **Add a place**. Changes are saved on the device.
- **In code** — add an entry to the `seedPlaces` array in `src/lib/places.ts`. This is the built-in dataset that seeds on-device storage on first launch and is restored by the admin **Reset to defaults** action.

## Admin panel

A PIN-gated admin section lets you manage places without touching code. Open it from the **About** screen → **🔐 Admin panel**.

- **Default PIN:** `1379` (change it under **Settings → Change PIN**)
- Add, edit, delete, and feature/unfeature places
- Reset everything back to the built-in dataset

Places are stored on-device with [AsyncStorage](https://react-native-async-storage.github.io/async-storage/) — no backend, fully offline. Edits flow straight into Home, Explore, and the detail screens. The unlock state resets each time the app restarts.

Key files:

```
src/lib/places-store.tsx   # Reactive, AsyncStorage-backed places store (CRUD)
src/lib/admin-auth.tsx     # PIN storage + in-memory unlock state
src/app/admin/             # Lock screen, dashboard, and create/edit form
```

## Building for the stores

This project uses [Expo](https://docs.expo.dev/build/setup/), so production builds are one command with EAS:

```bash
npx eas build --platform ios
npx eas build --platform android
```

## Web deployment (sporta.com.kw)

The web app is configured for the **sporta.com.kw** domain:

- **Origin** — `expo.extra.router.origin` in `app.json` sets canonical URLs and the sitemap to `https://sporta.com.kw`.
- **Metadata** — `src/app/+html.tsx` injects site-wide `<head>` tags (description, theme color, Open Graph, canonical); each screen sets its own `<title>` via `expo-router/head`.
- **Deep links** — `ios.associatedDomains` and `android.intentFilters` are set for `sporta.com.kw`, so `https://sporta.com.kw/...` links open the native app (universal links / App Links).

Build the static site and deploy the `dist/` folder to your host:

```bash
npx expo export --platform web   # outputs ./dist
```

> **Server-side files needed for deep links:** universal links require an
> [Apple App Site Association](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
> file at `https://sporta.com.kw/.well-known/apple-app-site-association` and an
> [assetlinks.json](https://developer.android.com/training/app-links/verify-android-applinks)
> at `https://sporta.com.kw/.well-known/assetlinks.json`. These live on the web
> host, not in this repo.

---

Made with ❤️ in Kuwait 🇰🇼
