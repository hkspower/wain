import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a fully static site into `out/` for upload to static hosting (Hostinger).
  output: "export",
  // Apache serves /explore/ -> out/explore/index.html cleanly with trailing slashes.
  trailingSlash: true,
  // No Node image optimizer exists on a static host.
  images: { unoptimized: true },
};

export default nextConfig;
