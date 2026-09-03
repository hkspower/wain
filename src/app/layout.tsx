import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  Barlow_Condensed,
  IBM_Plex_Sans_Arabic,
  Cairo,
  Noto_Naskh_Arabic,
  Alexandria,
} from "next/font/google";
import { hubHintOrigin } from "@/game/net";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--ff-sans",
});

// Racing display face: condensed, italic-capable — speed readouts,
// headings and the HUD's all-caps labels.
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--ff-display",
});

// Arabic is not one job, so it is not one face.
//
// UI and HUD: IBM Plex Sans Arabic — engineered rather than decorative,
// with a real weight range and the same technical temperament as the
// Latin racing UI it sits beside. Legible at HUD sizes, which the old
// Kufi was not: kufi's uniform strokes and low contrast blur together
// at 11px over a moving road.
const plexAr = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--ff-arabic",
});

// Headline moments — the VS card, area names, race banners. Cairo at
// 900 has the mass to stand next to Barlow Condensed's italic caps
// without either side looking like an afterthought.
const cairo = Cairo({
  subsets: ["arabic"],
  weight: ["700", "900"],
  variable: "--ff-arabic-display",
});

// Signage inside the world. Gulf road signs are naskh, not sans — the
// gantries, kilometre markers and roundabout boards read as real Kuwaiti
// street furniture in it and as a UI element in anything else.
const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--ff-arabic-sign",
});

// One family that speaks both languages.
//
// Every other face here is good at one script and borrows a stranger
// for the other: Plus Jakarta Sans has no Arabic, IBM Plex Sans Arabic
// has Latin but it is not the Latin the UI is set in. That is invisible
// in a paragraph and obvious in this game, where the two scripts sit
// INSIDE each other — "GARAGE الكراج", "Stake — مبلغ السباق" — on one
// line, at one size, sharing a baseline. Two families cannot agree
// about x-height, stroke weight or how far above the line a cap sits,
// so every one of those pairs is a small mismatch.
//
// Alexandria is drawn for both, so a bilingual pair is one typeface
// setting one line. Loaded as a variable font — one file covering
// 100 to 900 — because the alternative is picking three static weights
// and finding the fourth is the one a card needs.
const alexandria = Alexandria({
  subsets: ["latin", "arabic"],
  variable: "--ff-alexandria",
});

export const metadata: Metadata = {
  title: {
    default: "Wain? — Discover where to go in Kuwait",
    template: "%s | Wain?",
  },
  description:
    "Wain (وين) answers the eternal question: wain nrooh? Discover the best landmarks, food, beaches, shopping, and culture across Kuwait.",
  keywords: ["Kuwait", "places", "things to do", "wain", "discover", "travel"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hubOrigin = hubHintOrigin();
  return (
    // The font variables go on <html>, not <body>: the composed stacks in
    // globals.css live at :root and reference them, and a var() that is
    // undefined on the element where it is substituted makes the whole
    // declaration invalid — which silently dropped every family.
    <html
      lang="en"
      className={`${jakarta.variable} ${barlow.variable} ${plexAr.variable} ${cairo.variable} ${naskh.variable} ${alexandria.variable}`}
    >
      {/*
        Resolve the hub before the player needs it.

        This is the only host the game contacts that the browser has not
        already looked up. The six font families above do not count:
        next/font downloads them at build time and serves them from this
        origin, so there is no runtime trip to fonts.gstatic.com to warm —
        which is why there are no hints for them and should not be.

        The hub connection is made at the worst moment there is. The
        player has just pressed "race online" and is watching a spinner
        while a DNS lookup, a TCP handshake and a TLS negotiation all
        happen for the first time, in series, in front of them. Both hints
        are emitted because they do different jobs: dns-prefetch reliably
        removes the lookup, and preconnect additionally warms the socket
        where the browser will reuse it. Neither is load-bearing — the
        connection works exactly as before without them.

        Nothing is emitted when the hub is localhost, which is the default:
        a hint for a host that needs no resolution is markup that costs a
        parse and buys nothing.
      */}
      {hubOrigin && (
        <head>
          <link rel="dns-prefetch" href={hubOrigin} />
          <link rel="preconnect" href={hubOrigin} crossOrigin="anonymous" />
        </head>
      )}
      <body className="flex min-h-screen flex-col font-sans">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
