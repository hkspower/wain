# addons-src - the readable source of the generated add-on stylesheets

This directory is **not** under `public/`, so the build never copies it into `dist/`, `scripts/make-package.mjs` never stages it
and `scripts/vps-deploy.mjs` never ships it. Only the generated copy in `public/` goes live.

| source (edit this) | generated (never edit) |
|---|---|
| `addons-src/<name>.css` | `public/<name>.css` |

The generated file is the source with its comments and white space removed and a one-line header; nothing else is different
(the proof is `npm run test:addon-css-slim`).

## Edit

1. Edit `addons-src/<name>.css`. Keep the thorough comments: they carry the measured live facts and they cost the shopper nothing.
2. `npm run build:addon-css` rewrites `public/<name>.css`.
3. `node scripts/build-addon-css.mjs --check` (the drift guard) must exit 0; commit both files together.
4. `npm run test:addon-css-slim` re-proves that the generated file styles every admin screen exactly as the source does.

The builder refuses to overwrite a `public/<name>.css` that does not start with the generated header (somebody hand-edited the
shipped file): move that edit into `addons-src/` first.

### The build guard (when the build says "the minifier did more than drop comments and white space")

The proof covers the file as it is today; this directory is edited all the time, so the build itself checks, on every run, that the
output differs from the source in comments, white space and spelling only. It stops, and says what moved, when the minifier would:
rewrite a selector list with `:is()` (the plain members would take the specificity of the `:has()` member), add or drop a vendor
twin (`-webkit-user-select`, `-webkit-appearance`, `position:-webkit-sticky`), merge longhands into a shorthand (`grid-row` +
`grid-column` -> `grid-area`), collapse a fallback pair (`100vh` then `100dvh`), turn an escape inside a string (`content:"\201C"`)
into a raw character, round a number with more than 6 significant digits, or rewrite a media / container query. The fix is always
in the source: write the form the minifier would produce (or delete the prefix the browser floor no longer needs), then rebuild.
`--stats --all` shows which of the other add-on stylesheets the guard would stop as they are written.

## Status of the switch

`scripts/build-addon-css.mjs --apply` performs the one-time move (`git mv public/<name>.css addons-src/<name>.css`, then generate).
Until it has been run, the commented file still lives in `public/` and this directory holds only this note; the builder and the proof
both work in that state (`--from public/<name>.css --out <scratch file>`).

## Why the minifier is configured the way it is

See the header of `scripts/build-addon-css.mjs` and the "Lighter admin CSS" section of `PERFORMANCE.md`. In short: it runs with the
browser targets of the shop's own build and with the `light-dark()` polyfill off, because without targets it rewrites media queries to a
syntax Chrome 94-103 cannot read and merges `:has()` rules into lists that older browsers drop whole.
