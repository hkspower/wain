# Wain? — وين؟

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A modern place-discovery app for Kuwait: curated landmarks, food, beaches, shopping, culture, and family spots — each with highlights, the best time to visit, and a price level.

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router, React 19, TypeScript)
- [Tailwind CSS v4](https://tailwindcss.com)
- Fully static — no database or API keys needed to run

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
npm start
```

## Project structure

```
src/
├── app/
│   ├── layout.tsx            # Root layout (navbar + footer)
│   ├── page.tsx              # Landing page
│   ├── explore/              # Search + category filters
│   ├── places/[slug]/        # Place detail pages (statically generated)
│   ├── about/                # About Wain
│   ├── not-found.tsx         # 404 page
│   └── globals.css           # Tailwind theme (brand & sand palettes)
├── components/
│   ├── Navbar.tsx
│   ├── Footer.tsx
│   └── PlaceCard.tsx
└── lib/
    └── places.ts             # Place data, categories, and helpers
```

## Adding a place

Add an entry to the `places` array in `src/lib/places.ts` — the explore page, category filters, and a statically generated detail page at `/places/<slug>` all pick it up automatically.

---

Made with ❤️ in Kuwait 🇰🇼
