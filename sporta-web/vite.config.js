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
      // The promotion runs from ONE fixed inline script in <head>, not from an
      // onload="" attribute on each link: a CSP with no 'unsafe-inline' blocks
      // inline event handlers, but it can allow this exact script by hash
      // (scripts/csp-hashes.mjs writes that hash into the deployed .htaccess).
      // The listener is on document in the capture phase because load events
      // from <link> do not bubble.
      const promote =
        "<script>document.addEventListener('load',function(e){var t=e.target;" +
        "if(t&&t.tagName==='LINK'&&t.getAttribute('data-promote')!==null){t.rel='stylesheet';t.removeAttribute('data-promote')}},true)</script>"
      const replaced = html.replace(
        /<link rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g,
        (_m, before, href, after) =>
          `<link rel="preload" as="style"${before}href="${href}"${after} data-promote>` +
          `<noscript><link rel="stylesheet"${before}href="${href}"${after}></noscript>`,
      )
      return replaced.replace(/<head([^>]*)>/, (m) => m + promote)
    },
  }
}

// What the shopper sees when a lazy page cannot be fetched.
//
// Every page but the home page is a lazy chunk (App.jsx), and a chunk can fail to
// arrive: the network dropped for a second, or the tab was opened before a deploy
// removed the old hashed file. React.lazy remembers the rejection, nothing in the
// tree catches it, and React unmounts the whole tree -- an empty page with
// nothing to press, on the page where people pay. (SiteErrorBoundary exists but
// no route uses it.) MEASURED: build the commit before this one, block the
// checkout chunk and open /checkout from the bag: the page is blank.
//
// So the built index.html carries a few lines that notice an uncaught "could not
// import a module" and, ONLY if the page really is empty underneath, put a
// message and a Try again button on it. The button reloads: a browser keeps a
// failed module for the life of the page (measured in Chromium 153: a second
// import() of the same URL fails without sending a request), so a reload is the
// only retry that works in every browser, and it also picks up a newly deployed
// index.html. A failed PREFETCH (lib/prefetchRoute.js swallows it) raises no
// error event and leaves the page mounted, so it never shows the message. An
// import error while the page is working (something caught elsewhere) is ignored
// for the same reason.
//
// It lives in the HTML and not in React because it has to work when React has
// just fallen over, and because it covers all fourteen lazy pages at once.
// The price is on every page: about 0.5 kB of Brotli in index.html.
//
// SPLITTING THE CHECKOUT FURTHER WAS MEASURED AND IS NOT DONE. The page chunk is
// 26.3 kB raw / 7.1 kB Brotli, all of it on screen or used by every shopper
// except the quick-checkout card (3.4 kB). Making that card its own chunk, with
// the loading, retry and reserved-space code it needs, made a first-time
// shopper's checkout download 0.4-0.7 kB BIGGER and a returning shopper's 1.6-2.0
// kB bigger, and added a way for the checkout to fail that it did not have.
// And asking for the checkout chunk early (a <link rel=modulepreload> in the
// document on /checkout, so it travels with the entry script instead of after it)
// saved ~0.3 s to the first field on a throttled phone -- but the Arabic page then
// shifted while its loading skeleton was on screen (layout shift 0.01-0.09 in 10 of
// 67 loads, against none in 26 loads without it; a one-off 0.037 on the unchanged
// Arabic quick card says the race is in the app, not in the hint). It is not
// shipped. scripts/checkout-split-measure.mjs measures any two builds the same way.
function chunkFailureNet() {
  return {
    name: 'sporta-chunk-failure-net',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html // dev server: nothing is bundled
        const script =
          '<script>(function(){' +
          // Plain DOM and inline styles: no class of the app's stylesheet is available when the app has just
          // failed (style-src allows inline styles, see .htaccess).
          // The language is read from <html lang>, NOT from window.__SPORTA_LANG: boot.js writes both once, but
          // the toggle (i18n/LanguageContext) only updates <html lang>/<html dir>, so after a tap the global is
          // the language the page BOOTED in. Review found the message in the wrong language and direction on a
          // page the shopper had switched (English to Arabic and back); the global stays as the fallback.
          'function show(){var o=document.getElementById("root"),a=(document.documentElement.lang||window.__SPORTA_LANG)=="ar",d=document.createElement("div");' +
          'if(!o||o.children.length||document.getElementById("sporta-cf"))return;' +
          'd.id="sporta-cf";d.setAttribute("role","alert");d.dir=a?"rtl":"ltr";' +
          // min(28rem, 100% - 2rem): below 28rem + gutters the card used to touch both screen edges (320 and 390 px).
          'd.style.cssText="max-width:min(28rem,calc(100% - 2rem));margin:4rem auto;padding:1.5rem;text-align:center;background:#fff;color:#171a1e;border:1px solid #e2dbce;border-radius:1rem;font:16px/1.6 system-ui,sans-serif";' +
          'd.innerHTML="<p style=\'margin:0 0 1rem\'>"+(a?"تعذّر تحميل هذه الصفحة. تحقق من اتصالك ثم حاول مرة أخرى.":"This page could not load. Check your connection and try again.")+' +
          '"</p><button type=button style=\'background:#e0561c;color:#171a1e;font:700 15px system-ui,sans-serif;border:0;border-radius:9999px;padding:0 1.5rem;height:3rem;cursor:pointer\'>"+(a?"إعادة المحاولة":"Try again")+"</button>";' +
          'd.lastChild.onclick=function(){location.reload()};document.body.append(d);d.lastChild.focus()}' +
          'function bad(e){e=e&&(e.message||e.reason&&e.reason.message);' +
          '/dynamically imported module|importing a module script failed|unable to preload/i.test(e)&&setTimeout(show,300)}' +
          'addEventListener("error",bad);addEventListener("unhandledrejection",bad)})()</script>'
        return html.replace('</head>', () => script + '</head>')
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), nonBlockingCss(), chunkFailureNet()],
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
          // Vite's dynamic-import helper (__vitePreload, ~1.2 kB) is used by the entry AND by the lazy admin
          // shell, and a helper shared by two chunks gets a FILE of its own: one more request, 558 B Brotli,
          // on the first load of every storefront page (found in review, after the admin screens became lazy
          // chunks: a cold Arabic /checkout made 21 requests, 20 without that file; / made 28, 27 without it,
          // and the first-load Brotli total was 177 B lighter). Put in the framework chunk the entry already
          // loads, it costs no request. test:checkout-split A9 holds the document to three scripts.
          if (id.includes('vite/preload-helper')) return 'react-vendor'
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
