import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/' — the site is served at the domain root (public_html). Absolute
// asset paths are required so deep routes (/product/:slug) and refreshes on
// any route still load /assets/* correctly. ('./' breaks 2-segment routes.)
// The app stylesheet must not block the first paint.
//
// A render-blocking <link rel=stylesheet> stops the browser painting ANYTHING
// until it arrives — including the no-JavaScript shell in index.html, which is
// styled entirely by rules inlined in the <head> and needs nothing from it.
// Measured on a throttled phone: first paint was pinned at 1.8s, exactly when
// the 77 kB stylesheet landed, while the shell had been parseable since 250ms.
//
// Loading it as a preload that promotes itself to a stylesheet on arrival
// removes that gate. There is no flash of unstyled content to trade against,
// because nothing except the shell renders before the app's JavaScript — and
// the JavaScript is 340 kB against the stylesheet's 77 kB, so the CSS is
// always long since applied by the time React mounts. <noscript> keeps the
// page styled for a browser with JavaScript off.
function nonBlockingCss() {
  return {
    name: 'sporta-non-blocking-css',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g,
        (_m, before, href, after) =>
          `<link rel="preload" as="style"${before}href="${href}"${after} ` +
          `onload="this.onload=null;this.rel='stylesheet'">` +
          `<noscript><link rel="stylesheet"${before}href="${href}"${after}></noscript>`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), nonBlockingCss()],
  base: '/',
  build: {
    // Latest broadly-supported ES: class fields, top-level await, .at(),
    // logical assignment — less downleveling, smaller output.
    target: 'es2022',
    cssCodeSplit: true,
    // Warn later; our chunks are intentionally split below.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split rarely-changing framework code into its own chunk so it stays
        // cached across content deploys. The admin's own code stays in the
        // lazy AdminApp chunk automatically (only /backends imports it).
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
