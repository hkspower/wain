import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The HTML shell the static export writes around every page.
 *
 * Everything here is what a browser reads BEFORE any JavaScript runs: the
 * language, the reading direction, the tab's name, what a link preview shows.
 * The app sets its per-screen titles through the navigator, which cannot help
 * a crawler, a shared link, or the first paint — and until this file existed
 * every page in the export was called "127.0.0.1" and declared no language at
 * all, which leaves a screen reader to guess at Arabic.
 *
 * `lang` is Arabic because Arabic is this shop's default.
 *
 * `dir="rtl"` is NOT set here, and that is deliberate. This app has never
 * used a document-level direction — it cannot, because forcing RTL on native
 * needs a reload — so every screen sets its own per element, and the two
 * disagree about which end of a horizontal list is the start. Adding dir to
 * the document broke the shop's filter row: the first chip scrolled off the
 * left of the screen, because a scroll-to-the-end computed under a global RTL
 * lands at the opposite extreme from the one the components lay out for.
 * Measured, not theorised — the chip sat at x=-33 on a 390pt screen.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover so the safe-area insets the app already uses
            resolve to something on a notched phone rather than to zero. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#14161a" />

        {/* Links inherit their colour instead of taking the browser's blue.
            Every label in the app sets its own, so nothing SHOWS blue today —
            but the anchors the router generates carry #0000ee underneath, and
            the first piece of text added inside one without a colour of its
            own would arrive in a colour that is in no palette. The measured
            count on the storefront was four. */}
        <style dangerouslySetInnerHTML={{ __html: 'a{color:inherit;text-decoration:none}' }} />

        {/* Expo's own reset: it stops the BODY scrolling so that a ScrollView
            inside the app scrolls instead. Without it the page and the app's
            scroll views fight each other on web. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
