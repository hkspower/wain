import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "وين؟ — وين الطلعة اليوم؟",
    short_name: "وين؟",
    description: "أقرب الأماكن حواليك في الكويت.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdfaf3",
    theme_color: "#fdfaf3",
    lang: "ar",
    dir: "rtl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
