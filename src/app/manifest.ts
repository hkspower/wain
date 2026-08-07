import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "وين؟ — وين الطلعة اليوم؟",
    short_name: "وين؟",
    description: "أقرب الأماكن حواليك في الكويت.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    shortcuts: [
      {
        name: "استكشف الأماكن",
        url: "/explore/",
        icons: [{ src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "بحث",
        url: "/search/",
        icons: [{ src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    background_color: "#fdfaf3",
    theme_color: "#fdfaf3",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
