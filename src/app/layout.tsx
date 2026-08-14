import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  Barlow_Condensed,
  IBM_Plex_Sans_Arabic,
  Cairo,
  Noto_Naskh_Arabic,
} from "next/font/google";
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
  return (
    // The font variables go on <html>, not <body>: the composed stacks in
    // globals.css live at :root and reference them, and a var() that is
    // undefined on the element where it is substituted makes the whole
    // declaration invalid — which silently dropped every family.
    <html
      lang="en"
      className={`${jakarta.variable} ${barlow.variable} ${plexAr.variable} ${cairo.variable} ${naskh.variable}`}
    >
      <body className="flex min-h-screen flex-col font-sans">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
