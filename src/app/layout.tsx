import type { Metadata } from "next";
import { Baloo_Bhaijaan_2, Cairo } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
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
  openGraph: {
    title: "وين؟ — وين الطلعة اليوم؟",
    description: "أقرب الأماكن حواليك في الكويت.",
    locale: "ar_KW",
    type: "website",
  },
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
      </body>
    </html>
  );
}
