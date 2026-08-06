import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { LanguageProvider } from './i18n/LanguageContext.jsx'
import { CartProvider } from './lib/cart.jsx'
import { WishlistProvider } from './lib/wishlist.jsx'
import { ThemeProvider } from './lib/theme.jsx'
import { captureAttribution } from './lib/attribution.js'
import './styles/index.css'

// Which ad brought this visit, read from the landing URL before the shopper
// navigates away from it. See lib/attribution.js — by the time they reach the
// checkout the campaign is several clicks in the past, and an order that cannot
// name its campaign is an ad budget spent on instinct.
captureAttribution()

// The signal the boot watchdog in index.html waits for. Set from inside the
// tree rather than after render(), because render() only SCHEDULES work — a
// bundle that loads and then throws on its first render would otherwise clear
// the watchdog and leave the visitor with the same silent shell.
function Mounted() {
  useEffect(() => { window.__SPORTA_MOUNTED = true }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
      <LanguageProvider>
        <CartProvider>
          <WishlistProvider>
            <Mounted />
            <App />
          </WishlistProvider>
        </CartProvider>
      </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

// ---------------------------------------------------------------------------
// Offline support.
//
// Registered after load, not during it: a service worker install competes with
// the first render for bandwidth and main-thread time, and it has nothing to
// offer the visit it is installing on. Only over HTTPS, which is every real
// visit — the canonical host redirects anything else in one hop — and localhost,
// so it can be tested.
//
// It is registered LAST in this file for the same reason it is behind a load
// listener: nothing about the app should depend on it existing. See public/sw.js
// for what it will and will not cache; the short version is that /knet/, /pay/
// and config.js are never touched.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration costs offline support and nothing else. There is
      // no useful thing to tell the shopper, so there is no message.
    })
  })
}
