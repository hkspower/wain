/**
 * What every page's share card carries.
 *
 * Next merges metadata one key deep, so a page that sets its own `openGraph`
 * REPLACES the layout's rather than adding to it. /add set a title, a
 * description and a url, and lost the picture: a shared «سجّل مكانك» link
 * previewed with no image, and every place page dropped the site name and
 * locale the same way. A page restating `openGraph` spreads these first.
 */
export const OG_BASE = { siteName: "وين؟", locale: "ar_KW" } as const;

export const OG_DEFAULT_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  alt: "وين؟ — وين الطلعة اليوم؟",
} as const;
