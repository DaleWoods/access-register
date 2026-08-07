import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // CSV exports and evidence uploads travel through server actions.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
