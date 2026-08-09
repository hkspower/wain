import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Barlow_Condensed, Noto_Kufi_Arabic } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

// Racing display face: condensed, italic-capable — speed readouts,
// headings and the HUD's all-caps labels.
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

// Arabic companion so dialect lines don't fall back to a system face.
const kufi = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-arabic",
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
    <html lang="en">
      <body
        className={`${jakarta.variable} ${barlow.variable} ${kufi.variable} flex min-h-screen flex-col font-sans`}
      >
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
