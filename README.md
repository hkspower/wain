# Wain? — وين؟

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A modern place-discovery app for Kuwait: curated landmarks, food, beaches, shopping, culture, and family spots — each with highlights, the best time to visit, and a price level.

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router, React 19, TypeScript)
- [Tailwind CSS v4](https://tailwindcss.com)
- Fully static — no API keys needed to run (the optional back end is `/api/wain.php`)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
```

The site is a static export in `out/`. `next start` refuses `output: "export"`,
so there is no `npm start`: serve `out/` with any static server that maps
`/x/` to `/x/index.html` (for example `npx serve out`).

## Project structure

```
src/
├── app/
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Landing page
│   ├── explore/              # Search + category filters
│   ├── places/[slug]/        # Place detail pages (statically generated)
│   ├── about/                # About Wain
│   ├── not-found.tsx         # 404 page
│   └── globals.css           # Tailwind theme (brand & sand palettes)
├── components/
│   └── PlaceCard.tsx
└── lib/
    └── places.ts             # Place data, categories, and helpers
```

## Adding a place

Add an entry to the `places` array in `src/lib/places.ts` — the explore page, category filters, and a statically generated detail page at `/places/<slug>` all pick it up automatically.

---

Made with ❤️ in Kuwait 🇰🇼
