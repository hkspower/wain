import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import AppTabBar from "@/components/AppTabBar";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FahadLauncher from "@/components/FahadLauncher";
import "./globals.css";

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
  weight: ["400", "500", "600", "700"],
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
    title: "وين؟ — وين الطلعة اليوم؟",
    description: "أقرب الأماكن حواليك في الكويت — معالم، مطاعم، قهوة، شواطئ وأسواق.",
    url: "/",
    siteName: "وين؟",
    locale: "ar_KW",
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "وين؟ — وين الطلعة اليوم؟",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "وين؟ — وين الطلعة اليوم؟",
    description: "أقرب الأماكن حواليك في الكويت.",
    images: ["/og.jpg"],
  },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#fdfaf3",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body
        className={`${plex.variable} flex min-h-screen flex-col font-sans`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-ink-900 focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-lg"
        >
          تخطَّ إلى المحتوى
        </a>
        <Navbar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
        <FahadLauncher />
        <AppTabBar />
      </body>
    </html>
  );
}
