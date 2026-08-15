# Sporta — static HTML5 site

A framework-free version of the Sporta store: plain HTML5 + CSS + vanilla JS.
No build step, no npm — upload the folder and it runs.

## Pages
`index.html` · `shop.html` · `product.html?p=<slug>` · `cart.html` ·
`about.html` · `contact.html`

## Features
- Bilingual AR/EN with RTL, persisted; light/dark theme
- 20 products (`assets/products.js`, generated from the React catalog)
- Cart + wishlist in localStorage, size selection on apparel
- KNET checkout → `/knet/pay.php` (same PHP endpoints as the React site)
- Brand logo, orange/black palette, Changa + IBM Plex Arabic fonts
- SEO: per-page title/description/canonical/hreflang, Open Graph,
  OnlineStore structured data, robots.txt, sitemap.xml, llms.txt
- Semantic landmarks, aria labels, visible focus, reduced-motion support

## Deploy (Hostinger)
Upload everything into `public_html/` (include `.htaccess` — enable
"show hidden files"). Payment endpoints go in `public_html/knet/`
(see `sporta-web/dropin/php-knet/`).

## Keeping products in sync
`assets/products.js` is generated from `sporta-web/src/lib/products.js`,
which stays the single source of truth.
