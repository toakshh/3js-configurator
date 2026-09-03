import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // three ships ESM and needs no transpilation; Turbopack handles CSS directly.
};

export default nextConfig;
