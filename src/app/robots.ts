import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    // /orders/ and /queue/ are per-device screens with nothing in them to index.
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/orders/", "/queue/"] },
    sitemap: "https://www.wainkw.com/sitemap.xml",
    host: "https://www.wainkw.com",
  };
}
