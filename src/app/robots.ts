import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/"] },
    sitemap: "https://www.wainkw.com/sitemap.xml",
    host: "https://www.wainkw.com",
  };
}
