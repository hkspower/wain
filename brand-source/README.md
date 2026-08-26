# Brand source

Master logo files, lockups and colour variants.

These are **design sources, not site assets** — nothing on wainkw.com links to
them, so they live outside `public/` and are no longer uploaded on every
deploy (they were costing ~330 KB per upload while never being requested).

Still served from `public/brand/`:

- `app-icon-192.png`, `app-icon-512.png`, `app-icon-maskable-512.png` —
  referenced by the web app manifest; these are what the installed app uses.
- `kuwait-mix.png` — the Kuwait composite. **Nothing on the site links to it**;
  it is kept at a stable public URL on purpose, so it can be shared directly.
  That costs 193 KB on every upload and every host backup for a URL no page
  points at, so it is worth revisiting — but it is deliberate, not an oversight,
  and `scripts/audit-assets.mjs` names it as such rather than reporting it as
  dead weight.

`wain-logo.svg` moved here from `public/brand/` — nothing fetched it. The
`WainLogo` component **is** the rendered logo; this file is the master it
mirrors, which is the definition of a design source. Keep the two in sync.

Use these files for anything off-site: print, social banners, partner decks.
