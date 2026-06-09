import type { NextConfig } from "next";

// NEXT_OUTPUT=export produces a fully static build in `out/`, which the
// Electron shell in `desktop/` loads for the Steam PC build.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_OUTPUT === "export"
    ? { output: "export" as const, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
