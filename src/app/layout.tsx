import type { Metadata, Viewport } from "next";
import { Baloo_Bhaijaan_2, Cairo } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FahadLauncher from "@/components/FahadLauncher";
import "./globals.css";

/** Rounded, friendly Kufi-ish face for the وين wordmark and headings. */
const display = Baloo_Bhaijaan_2({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
});

/** Highly legible Arabic body face. */
const arabic = Cairo({
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
        url: "/og.png",
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
    images: ["/og.png"],
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
        className={`${display.variable} ${arabic.variable} flex min-h-screen flex-col font-sans`}
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
      </body>
    </html>
  );
}
