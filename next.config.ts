import type { NextConfig } from "next";

// NEXT_OUTPUT=export produces a fully static build in `out/`, which the
// Electron shell in `desktop/` loads for the Steam PC build.
const isExport = process.env.NEXT_OUTPUT === "export";

/**
 * Caching for everything under public/.
 *
 * Next gives its own build output (/_next/static) content-hashed names
 * and caches it for a year. public/ gets neither: it is served with
 * `Cache-Control: public, max-age=0`, so the browser has to ask
 * permission before reusing a byte of it. Measured on this repo that is
 * 11 MB of car geometry revalidated on every single page load — the
 * models are 2.8 MB each and there are four of them — plus the textures,
 * the radio beds and every sound the game ships.
 *
 * The reason it was left that way is real: the filenames are stable
 * across rebuilds, so caching `car-gtr.glb` for a year serves last
 * month's geometry to anyone who already has it. The fix is not a
 * shorter max-age, it is a key. src/game/models.ts now fingerprints
 * build.json — the manifest it already downloads — and asks for
 * `car-gtr.glb?v=<hash>`, so a rebuild changes the URL and the old entry
 * is simply never requested again.
 *
 * That makes the split below safe:
 *
 *   build.json   the index that busts everything else, so it must never
 *                be held. no-cache means "revalidate every time", not
 *                "do not store": a 304 on 4 KB is one small round trip.
 *   .glb         immutable, addressed by the fingerprint above.
 *   the rest     a day, with stale-while-revalidate so a refetch is
 *                never in front of the player. Sounds and textures are
 *                not versioned, so this is the compromise: at most a day
 *                stale, and never a blocking revalidation.
 *
 * Not applied to `output: export`. A static export has no server to send
 * headers, and Next warns rather than failing, which would leave a
 * reassuring block of configuration here doing nothing for the Steam
 * build. Whatever serves `out/` sets these itself.
 */
const publicHeaders = [
  {
    source: "/models/build.json",
    headers: [{ key: "Cache-Control", value: "public, no-cache" }],
  },
  {
    source: "/models/:file*.glb",
    headers: [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ],
  },
  {
    source: "/:dir(textures|radio|sfx|music|voices|cars)/:file*",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=86400, stale-while-revalidate=604800",
      },
    ],
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isExport
    ? { output: "export" as const, images: { unoptimized: true } }
    : { headers: async () => publicHeaders }),
};

export default nextConfig;
