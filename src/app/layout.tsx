import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
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
      <body className={`${jakarta.variable} flex min-h-screen flex-col font-sans`}>
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
