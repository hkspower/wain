import type { MetadataRoute } from "next";
import { places } from "@/lib/places";

export const dynamic = "force-static";

const BASE = "https://www.wainkw.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    { url: `${BASE}/`, priority: 1 },
    { url: `${BASE}/explore/`, priority: 0.9 },
    { url: `${BASE}/about/`, priority: 0.5 },
    { url: `${BASE}/privacy/`, priority: 0.3 },
  ];
  const placeRoutes = places.map((p) => ({
    url: `${BASE}/places/${p.slug}/`,
    priority: 0.7,
  }));
  return [...staticRoutes, ...placeRoutes].map((r) => ({
    ...r,
    changeFrequency: "monthly" as const,
  }));
}
