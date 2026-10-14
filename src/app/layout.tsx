import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import AppShell from "@/components/AppShell";
import AppTabBar from "@/components/AppTabBar";
import { LiveTray } from "@/components/OrdersLink";
import RouteTransitions from "@/components/RouteTransitions";
import ScrollMemory from "@/components/ScrollMemory";
import { NavDepth } from "@/components/BackButton";
import WainAi from "@/components/WainAi";
import { OG_BASE, OG_DEFAULT_IMAGE } from "@/lib/site-meta";
import { SHOW_STANDINS } from "@/lib/landmark-gate";
import { LANDMARKS } from "@/lib/landmarks.g";
import "./globals.css";

/**
 * A preview build that shows drawn stand-ins says so on every page, in a way
 * a test and deploy:plan can read without guessing from pictures: the marker
 * is what refuses such an export. Absent from every normal build, and from a
 * preview build once every picture is real.
 */
const PREVIEW = SHOW_STANDINS && LANDMARKS.some((l) => l.source !== "ai") ? "stand-ins" : undefined;

/**
 * Is this the installed app — decided before the first paint, not after it.
 *
 * The app chrome (the tab bar, the room under the page for it) keys off
 * `display-mode: standalone` and off <html data-standalone>, which AppShell
 * sets in an effect, i.e. after hydration. On an iPhone the media query never
 * matches: an installed web app whose manifest says `standalone` reports
 * `display-mode: fullscreen` instead (WebKit bug 264218; BCD says so). So every
 * launch from the home screen painted the WEBSITE — no tab bar, no room for
 * it — and the bar arrived under the thumb once the JavaScript had run
 * (8 October). `navigator.standalone` is iOS's own answer and is there from
 * the first byte, so this reads it, with AppShell's other two signals, while
 * the <head> is still being parsed. A constant string, nothing of the
 * visitor's in it; AppShell keeps the attribute in step afterwards.
 */
const STANDALONE_BEFORE_PAINT =
  'try{var a=navigator.standalone===true||matchMedia("(display-mode: standalone)").matches||' +
  'window.Capacitor?.isNativePlatform?.()===true;' +
  'document.documentElement.setAttribute("data-standalone",a?"true":"false")}catch(e){}';

/**
 * One family for the whole site: IBM Plex Sans Arabic.
 *
 * Purpose-built for interfaces (Bold Monday for IBM's design system), so its
 * Arabic stays legible at 12px in a chip and authoritative at 40px in a
 * headline. Hierarchy comes from weight, not from a second face clashing with
 * the first — which is what reads "official" rather than decorative. Shipping
 * one family instead of two also cuts a whole font download on mobile.
 *
 * Keep "latin" in the subsets even though no Latin *word* is ever set here.
 * The Latin subset's unicode-range covers U+0000–00FF, which includes the
 * space character, so Arabic text matches it regardless. Dropping the subset
 * does not stop the download — it only stops the preload, so the same bytes
 * arrive later and block render for longer. Measured both ways.
 */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  // 500 was requested for two labels and cost two preloaded font files;
  // those now use 600, which the site loads anyway.
  weight: ["400", "600", "700"],
  variable: "--font-arabic",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.wainkw.com"),
  title: {
    default: "وين؟ — وين الطلعة اليوم؟",
    template: "%s | وين؟",
  },
  description:
    "وين يجاوب على سؤال الطلعة: أقرب الأماكن حواليك في الكويت — معالم، مطاعم، قهوة، شواطئ وأسواق.",
  keywords: ["الكويت", "وين", "طلعة", "مطاعم الكويت", "أماكن", "معالم الكويت", "Kuwait"],
  alternates: { canonical: "/" },
  openGraph: {
    ...OG_BASE,
    title: "وين؟ — وين الطلعة اليوم؟",
    description: "أقرب الأماكن حواليك في الكويت — معالم، مطاعم، قهوة، شواطئ وأسواق.",
    url: "/",
    type: "website",
    images: [OG_DEFAULT_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "وين؟ — وين الطلعة اليوم؟",
    description: "أقرب الأماكن حواليك في الكويت.",
    images: ["/og.jpg"],
  },
  // The home-screen icon is the PNG, never the SVG: iOS has no SVG support for
  // apple-touch-icon, so «Add to Home Screen» on an iPhone was given a file it
  // cannot draw and fell back to a screenshot of the page (8 October). 180×180
  // and opaque — iOS fills transparency with black. audit:assets holds both.
  // The tab icon has a PNG before the SVG for the same browser: Safari reads
  // SVG favicons only from 26, so 16.4–18 showed a blank letter tile. Listed
  // PNG first and typed, so a browser that can use the SVG still takes it.
  icons: {
    icon: [
      { url: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, title: "وين؟", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  // The app draws its own background behind the status bar area; without this
  // iOS reserves an opaque bar and the launch reads as a web view.
  viewportFit: "cover",
  // The keyboard shrinks the page on Android instead of sliding over it, so a
  // chat's box stays above it (/salem). iOS ignores this; /salem follows the
  // visual viewport itself there.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The font variable belongs on <html>, not <body>. @theme declares
  // --font-sans and --font-display on :root as var(--font-arabic), … — and a
  // custom property that references an undefined variable is invalid at
  // computed-value time, so defining --font-arabic any lower left both of them
  // empty on :root, body inherited the invalid value, and every
  // font-sans/font-display element silently fell back to the default
  // ui-sans-serif stack with the webfont never requested at all.
  return (
    // suppressHydrationWarning: the script below writes data-standalone onto
    // this element before React sees it, on purpose.
    <html
      lang="ar"
      dir="rtl"
      className={plex.variable}
      suppressHydrationWarning
      {...(PREVIEW ? { "data-preview": PREVIEW } : {})}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: STANDALONE_BEFORE_PAINT }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        {/* This link is NOT why the home page used to scroll sideways, however
            much it looked like it. `audit:mobile` names every element sitting
            past the viewport edge, and an `sr-only` element pinned to the
            inline start of an already-too-wide document is the first row in
            that list — a passenger, printed above the driver. Hiding it left
            the document exactly as wide; hiding <main> fixed it. The cause was
            a scroll rail on the home page bleeding 16px into a 10px gutter.
            Left as it was, so the next reader does not re-fix it. */}
        <a
          href="#main-content"
          // Its own surface: the body is dark under /find's end (globals.css,
          // data-dark-end), and a clipped link inheriting ink over sea-950
          // read 1.10:1 to audit:color. Focused, it is ink-900 on white as before.
          className="sr-only bg-white text-ink-900 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-ink-900 focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-lg"
        >
          تخطَّ إلى المحتوى
        </a>
        {/* No top bar. Removed deliberately, and it took the site's only
            browser-side navigation with it: the home link, the ⌘K search
            palette (and its keydown listener, which lived in SearchPalette
            and is now never mounted), and استكشف/عن وين. AppTabBar is
            `standalone:block`, so it does not stand in for any of that
            outside the installed app. Two of the losses were real enough to
            answer: the home page carries the site's one link to /search, and
            LiveTray below carries the order and ticket pills. */}
        <main id="main-content" className="flex-1">
          {children}
        </main>
        {/* Renders nothing at all unless this device has a live order or
            today's ticket, which is why it is not the top bar coming back —
            see LiveTray. */}
        <LiveTray />
        {/* Above the router, offered on /find (hers) and in سالم's header
            (his). It has to outlive a route change because `open_place` is a
            route change: a call mounted by the page that offered it would be
            killed by its own tool. See WainAi. */}
        <WainAi />
        <AppTabBar />
        <AppShell />
        <RouteTransitions />
        <ScrollMemory />
        <NavDepth />
      </body>
    </html>
  );
}
