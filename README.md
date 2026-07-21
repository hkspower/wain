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

Add an entry to the `places` array in `src/lib/places.ts` — the explore list, category filters, and the detail screen at `/place/<slug>` all pick it up automatically.

## Building for the stores

This project uses [Expo](https://docs.expo.dev/build/setup/), so production builds are one command with EAS:

```bash
npx eas build --platform ios
npx eas build --platform android
```

---

Made with ❤️ in Kuwait 🇰🇼
