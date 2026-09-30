/* Sporta — put a link to /returns/request on the /returns policy page.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * /returns/request is a flat page (returns-request.html), because the
 * storefront is a built React bundle whose source is not in this repository.
 * A page nothing links to is a page nobody visits — the loyalty card spent
 * months in exactly that state, working perfectly and unreachable — and the
 * one place a customer looking to return something will actually go is the
 * returns policy page.
 *
 * ------------------------------------------------- WHY THE POLICY PAGE NEEDS IT
 *
 * That page already has a form, and the form is the problem this replaces: it
 * offers the WHOLE CATALOGUE to pick from, not the order's own lines, and it
 * hands the result to WhatsApp without checking that the order exists or
 * writing anything down. So the link is placed ABOVE it — first thing under
 * the heading — and says what the difference is. The old form is left exactly
 * where it is and still works; nothing of the owner's design is removed.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * This is DOM surgery on a page whose source I do not hold, and it should be
 * read as such — same class of thing as contact.js, same failure mode. If it
 * cannot find the heading it inserts nothing and the page is untouched. If the
 * storefront is ever rebuilt, check the anchor below still matches. Deleting
 * the <script> tag in index.html reverts the whole thing.
 */
(function () {
  'use strict'

  var ID = 'sporta-returns-request-link'

  var build = function () {
    var a = document.createElement('a')
    a.id = ID
    a.href = '/returns/request'
    /* A REAL NAVIGATION, not a router link. The app's router has never heard
       of /returns/request — Apache rewrites it to a flat file — so letting
       React intercept the click would land the customer on the 404 screen. An
       <a> with a plain href does the right thing; nothing here calls
       preventDefault, and the SPA only hijacks its own <Link> components. */
    a.setAttribute('data-sporta', 'returns-request')

    /* Tailwind's own utility classes, so this matches the page it sits on in
       both themes rather than carrying a palette of its own that would drift
       the next time the ramp moves. */
    a.className = 'mb-5 flex items-center justify-between gap-3 rounded-2xl ' +
                  'border border-brand/30 bg-brand/5 p-4 no-underline'

    var text = document.createElement('span')
    var title = document.createElement('span')
    title.className = 'block font-bold'
    title.textContent = 'اطلب الإرجاع أو الاستبدال من طلبك'
    var sub = document.createElement('span')
    sub.className = 'block text-sm opacity-75'
    sub.textContent = 'أدخل رقم طلبك وسنعرض لك القطع التي اشتريتها فعلًا، ونعطيك رقم متابعة.'
    text.appendChild(title)
    text.appendChild(sub)

    var chevron = document.createElement('span')
    chevron.setAttribute('aria-hidden', 'true')
    chevron.className = 'shrink-0 text-xl'
    chevron.textContent = '‹'          /* RTL page: the arrow points leftward */

    a.appendChild(text)
    a.appendChild(chevron)
    return a
  }

  var place = function () {
    if (window.location.pathname.replace(/\/+$/, '') !== '/returns') {
      /* Navigated away. Remove ours rather than leaving it on /terms — the
         SPA reuses the same <main> across routes. */
      var stale = document.getElementById(ID)
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale)
      return
    }
    if (document.getElementById(ID)) return          // already placed

    /* The anchor: the page's own <h1>, inside the heading row. The card goes
       after that row, which is the first thing under the title in reading
       order and above the old form. */
    var h1 = document.querySelector('main h1')
    if (!h1) return
    var row = h1.parentElement
    if (!row || !row.parentNode) return
    row.parentNode.insertBefore(build(), row.nextSibling)
  }

  place()

  /* THE SHOP IS A SINGLE-PAGE APP, so /returns is rendered after this script
     has run and re-rendered on every navigation. One pass at load would only
     ever fix the page that happened to be open first.

     Debounced through requestAnimationFrame because React mutates in bursts,
     and flagged because our own insert is a mutation too — without the flag
     this is an observer answering itself for ever. */
  var queued = false, ours = false
  new MutationObserver(function () {
    if (ours || queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      ours = true
      try { place() } finally { ours = false }
    })
  }).observe(document.body, { childList: true, subtree: true })
})()
