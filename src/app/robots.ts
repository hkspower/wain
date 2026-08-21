import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    // /orders/ is a per-device screen with nothing in it to index.
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/orders/"] },
    sitemap: "https://www.wainkw.com/sitemap.xml",
    host: "https://www.wainkw.com",
  };
}
