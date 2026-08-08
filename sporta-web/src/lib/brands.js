import { phpBase } from './backend'

// A brand logo's URL.
//
// THERE IS NO FETCH HERE. The brand a product belongs to — its slug, its names
// and its logo's content hash — is joined into ?r=products and arrives with the
// product itself, so the product page makes no extra request. This module is
// only the one rule that both the storefront and any future consumer must agree
// on: how a logo's URL is spelled.
//
// The bytes are NOT in that payload and must not be. A logo is a data: URI up
// to 160 kB stored in the row (never a file — an upload endpoint would write
// into the web root), and /api is `no-store`, so every product sharing a brand
// would carry its own copy of it on every page load.
//
// The content hash is in the query string, and that is what makes a one-year
// immutable cache safe: change the logo and the URL changes with it, so the new
// one appears without anybody clearing anything.
export const brandLogoUrl = (brand) =>
  brand?.hasLogo
    ? `${phpBase()}/api.php?r=brand_logo&slug=${encodeURIComponent(brand.slug)}&v=${brand.v}`
    : null
