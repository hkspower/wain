# Wain? — وين؟

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A modern place-discovery app for Kuwait: curated landmarks, food, beaches, shopping, culture, and family spots — each with highlights, the best time to visit, and a price level.

## 🏁 Gulf Road Nights — ليالي شارع الخليج

A built-in **Kuwait Xtreme Racer** game at [`/race`](http://localhost:3000/race): Tokyo-Xtreme-Racer-style midnight highway battles on a 7.3 km lap of the real **Gulf Road** — south along the corniche from the Kuwait Towers past Green Island, the Salmiya marina, and the Scientific Center to Ras Al-Ard, then back north through Hawally and the city skyline (Al Hamra, Liberation Tower, the striped water towers).

- **Drive**: `W/↑` accelerate, `S/↓` brake, `A`/`D` steer, `M` mute
- **Battle**: catch a rival and press `F` to flash your headlights — the trailing car bleeds SP (Spirit Points); empty the rival's bar to win
- **Roster**: six street legends from Salmiya to Jahra, ending with the boss, *Shabah Al-Khaleej* (شبح الخليج)
- Progress is saved locally; beat all six to become **King of Gulf Road** 👑

Want it as a desktop / Steam PC build? See [`desktop/README.md`](desktop/README.md) for the Electron + Steamworks packaging guide.

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
