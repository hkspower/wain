# Wain? — وين؟

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A modern place-discovery app for Kuwait: curated landmarks, food, beaches, shopping, culture, and family spots — each with highlights, the best time to visit, and a price level.

## 🏁 Gulf Road Nights — ليالي شارع الخليج

A built-in **Kuwait Xtreme Racer** game at [`/race`](http://localhost:3000/race): Tokyo-Xtreme-Racer-style midnight highway battles on a 7.3 km lap of the real **Gulf Road** — south along the corniche from the Kuwait Towers past Green Island, the Salmiya marina, and the Scientific Center to Ras Al-Ard, then back north through Hawally and the city skyline (Al Hamra, Liberation Tower, the striped water towers).

- **Drive**: `W/↑` accelerate, `S/↓` brake, `A`/`D` steer, `M` mute, `V` voices, `G` glow fx
- **Voices**: rivals speak Kuwaiti dialect lines (battle intros, gloats, concessions) through the browser's Arabic speech voices — each character has their own pitch and pace, from Abu Shanab's cheerful jab to the ghost's slow rasp
- **Battle**: catch a rival and press `F` to flash your headlights — the trailing car bleeds SP (Spirit Points); empty the rival's bar to win
- **Roster**: six street legends from Salmiya to Jahra, ending with the boss, *Shabah Al-Khaleej* (شبح الخليج)
- Progress is saved locally; beat all six to become **King of Gulf Road** 👑

### Online Hub — تجمع شارع الخليج

A shared multiplayer cruise at [`/hub`](http://localhost:3000/hub): pick a driver name and car colour, see who's online, chat in the diwaniya, and check the session's best-lap leaderboard — then **Enter the Cruise** to drive the same midnight Gulf Road with everyone else (other drivers appear live in-world with name tags).

The hub is backed by a tiny self-hostable WebSocket server:

```bash
npm run hub          # starts the hub server on ws://localhost:8787
```

Point clients elsewhere with `NEXT_PUBLIC_HUB_WS=wss://your-server:8787` at build time (and `HUB_PORT` for the server). State is in-memory — restarting clears the leaderboard. Battles stay single-player; the cruise, chat, and lap times are shared.

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
