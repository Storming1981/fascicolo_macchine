import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autoconsistente per il container (immagine leggera, avvio con node server.js)
  output: "standalone",
  turbopack: { root: __dirname },
  // pdfjs e mammoth vanno caricati da Node a runtime, non impacchettati:
  // il bundler rompe i worker/asset interni di pdfjs.
  serverExternalPackages: ["pdfjs-dist", "mammoth"],
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
