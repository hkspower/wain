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

// A lazy page's chunk, requested WITH the entry instead of after it.
//
// THE WATERFALL. /checkout is its own chunk (src/pages/Checkout.jsx), which is
// right: nobody browsing the shop downloads it. But the browser only learns the
// file's name when the entry chunk has downloaded, parsed and run, the router
// has matched the URL and React.lazy has called import() -- one full round trip
// AFTER the entry, on a path where the entry is already the slow part. For
// anyone who lands on /checkout directly (a reload, the Back button from the
// bank's page, a link) that is a serial hop the page does not need to wait for:
// the URL says which page it will be, before any JavaScript has run.
//
// So the built index.html learns, at build time, which files make up the
// checkout page (its chunk and the small chunks only it and the cart share) and
// asks for them with <link rel=modulepreload> when -- and ONLY when -- the path
// is /checkout. Every other page is told nothing and downloads nothing extra.
// The hint is the same request the page makes anyway, made earlier and shared:
// import() finds it in flight or finished. Vite's own preload helper skips a
// link that is already there. It is marked fetchpriority=low so that nine
// kilobytes of checkout never queue ahead of the entry script and the
// stylesheet the first paint is waiting for (the browser raises it once the
// page really asks for the file).
//
// THE FAILURE. The same inline script carries the other half of a lazy page:
// what the shopper sees when its file cannot be fetched (the network dropped, or
// the tab was opened before a deploy removed the old hashed file). React.lazy
// remembers the rejection, nothing catches it, and React unmounts the whole tree
// -- an empty page with nothing to press, on the page where people pay. An
// uncaught "failed to import a module" now leaves a message and a Retry button
// over the empty page. Retry reloads: a browser keeps a failed module for the
// life of the page (measured in Chromium 153: a second import() of the same URL
// fails without a request), so a reload is the only retry that works everywhere,
// and it also picks up a newly deployed index.html.
// A failed PREFETCH (lib/prefetchRoute.js swallows it) raises no error event and
// leaves the page mounted, so it never shows the message.
//
// To give another lazy page the same early request, add it here: one line.
const PRELOADED_ROUTES = { '/checkout': 'src/pages/Checkout.jsx' }

function routePreload() {
  let base = '/'
  return {
    name: 'sporta-route-preload',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html // dev server: nothing is bundled
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
        const closure = (start) => {
          const seen = new Set()
          const walk = (c) => {
            if (!c || seen.has(c.fileName)) return
            seen.add(c.fileName)
            for (const f of c.imports) walk(bundle[f])
          }
          walk(start)
          return seen
        }
        // What the document already loads: the entry and everything it imports.
        const entry = chunks.find((c) => c.isEntry)
        const inEntry = entry ? closure(entry) : new Set()
        const map = {}
        for (const [route, src] of Object.entries(PRELOADED_ROUTES)) {
          const page = chunks.find(
            (c) => c.isDynamicEntry && (c.facadeModuleId ?? '').replace(/\\/g, '/').endsWith(`/${src}`),
          )
          if (!page) throw new Error(`sporta-route-preload: no lazy chunk was built for ${src}`)
          map[route] = [...closure(page)].filter((f) => !inEntry.has(f)).map((f) => base + f)
        }
        const script =
          '<script>(function(){var m=' + JSON.stringify(map) + ',p=location.pathname,r,i,l;' +
          'for(r in m)if(p===r||p.indexOf(r+"/")===0)for(i=0;i<m[r].length;i++){' +
          'l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.fetchPriority="low";l.href=m[r][i];document.head.appendChild(l)}' +
          // The failure message. Plain DOM and inline styles: no class of the app's stylesheet is
          // available when the app has just failed (style-src allows inline styles, see .htaccess).
          'function show(){var o=document.getElementById("root"),a=(window.__SPORTA_LANG||document.documentElement.lang)=="ar",d=document.createElement("div");' +
          'if(!o||o.children.length||document.getElementById("sporta-cf"))return;' +
          'd.id="sporta-cf";d.setAttribute("role","alert");d.dir=a?"rtl":"ltr";' +
          'd.style.cssText="max-width:28rem;margin:4rem auto;padding:1.5rem;text-align:center;background:#fff;color:#171a1e;border:1px solid #e2dbce;border-radius:1rem;font:16px/1.6 system-ui,sans-serif";' +
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
  plugins: [react(), nonBlockingCss(), routePreload()],
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
