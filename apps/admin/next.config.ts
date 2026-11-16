import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@privateride/shared"],
};

export default nextConfig;
