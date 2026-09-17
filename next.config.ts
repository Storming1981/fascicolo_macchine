import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autoconsistente per il container (immagine leggera, avvio con node server.js)
  output: "standalone",
  turbopack: { root: __dirname },
  // pdfjs e mammoth vanno caricati da Node a runtime, non impacchettati:
  // il bundler rompe i worker/asset interni di pdfjs.
  // web-push: senza questa riga non finiva in .next/standalone/node_modules
  // (verificato su due build pulite; con la riga: presente e risolvibile da
  // dentro lo standalone). E' la stessa trappola del worker di pdfjs: in
  // locale non si vede, perche' li' node_modules e completo.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "web-push"],
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
