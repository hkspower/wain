# Performance optimizations — Sporta web

Applied to this app; the same techniques apply to the real Lovable/Vite project.

## What changed & why

### 1. Route-level code splitting (`src/App.jsx`)
`About`, `Services`, `Contact`, and the entire **admin** are now
`React.lazy()` imports behind `<Suspense>`. A first-time visitor to the home page
no longer downloads admin/checkout code they don't need.

**Result — entry bundle: 172 kB → 8 kB.** Other routes load on demand as tiny
chunks (< 1 kB each).

### 2. Vendor chunk isolation (`vite.config.js`)
React / React-DOM / React-Router are split into a stable `react-vendor` chunk.
It only changes when you upgrade those libraries, so returning visitors keep it
cached across content deploys instead of re-downloading on every change.

### 3. Modern build target
`target: 'es2020'` skips legacy transpilation → smaller, faster JS for the
modern browsers KNET/CBK already require (TLS 1.2 era).

### 4. Hostinger compression + caching (`public/.htaccess`)
The single biggest real-world win:
- **Brotli/gzip** on all text assets (HTML/CSS/JS/SVG).
- **`Cache-Control: immutable, max-age=1yr`** on hashed assets (`index-AbC123.js`)
  — repeat visits are near-instant.
- **HTML `no-cache`** so new deploys show up immediately.
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

## Final build (gzip)
| Asset | Size |
|---|---|
| entry `index.js` | 3.6 kB |
| `react-vendor.js` | 53 kB (cached long-term) |
| CSS | 3.4 kB |
| About / Services / Contact / Admin | on-demand, < 1 kB each |

## Applying to the real Lovable app
Lovable uses the same Vite + React stack, so:
1. Lazy-load routes with `React.lazy` (especially admin + checkout).
2. Add the `manualChunks` block to its `vite.config.ts`.
3. Deploy this `public/.htaccess` alongside the build (it's what makes Hostinger
   serve compressed, cacheable assets).
4. Compress/serve images as WebP/AVIF and add `loading="lazy"` to below-the-fold
   images.

## Further wins (when there's real content)
- Convert hero/product images to **WebP/AVIF**, add width/height to avoid layout shift.
- `loading="lazy"` on offscreen images.
- Preload the primary font weight only; keep `font-display: swap` (already set).
- Consider prerendering the marketing pages to static HTML for instant first paint.
