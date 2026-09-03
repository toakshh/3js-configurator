import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  turbopack: {
    // no lightningcss override needed — Turbopack handles CSS directly
  },
};

export default nextConfig;
