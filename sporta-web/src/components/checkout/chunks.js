// The checkout's lazily loaded parts, each named ONCE.
//
// Every call site that wants a chunk (the page that renders it, the prefetch
// that warms it on intent) must pass the very same function, because
// lib/retryImport.js identifies a chunk by its loader. Two copies of
// `() => import('../QuickCheckout')` would be two cache entries for one file
// and the warm-up would never be found by the component that needs it.
//
// This file is tiny on purpose: it is imported from the app's entry chunk by
// lib/prefetchRoute.js, so everything it costs is paid by every page.

// The quick-checkout card (components/QuickCheckout.jsx, ~3.4 kB raw). Only a
// returning shopper with complete saved details ever sees it, and they see it
// INSTEAD of the form, so a first-time shopper never needs a byte of it.
export const loadQuickCheckout = () => import('../QuickCheckout')
