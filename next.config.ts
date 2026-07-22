import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autoconsistente per il container (immagine leggera, avvio con node server.js)
  output: "standalone",
  turbopack: { root: __dirname },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
