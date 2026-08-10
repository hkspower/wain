# Brand source

Master logo files, lockups and colour variants.

These are **design sources, not site assets** — nothing on wainkw.com links to
them, so they live outside `public/` and are no longer uploaded on every
deploy (they were costing ~330 KB per upload while never being requested).

Still served from `public/brand/`, because the site needs them:

- `app-icon-192.png`, `app-icon-512.png`, `app-icon-maskable-512.png` —
  referenced by the web app manifest; these are what the installed app uses.
- `wain-logo.svg` — the source of truth the `WainLogo` component mirrors.
- `kuwait-mix.png` — the Kuwait composite, kept fetchable so the URL can be
  shared directly.

Use these files for anything off-site: print, social banners, partner decks.
