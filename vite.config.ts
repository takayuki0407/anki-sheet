/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Base is relative so the built app can be opened from any subpath / static host.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Anki-sheet 赤シート暗記",
        short_name: "Anki-sheet",
        lang: "ja",
        description: "赤シート対応PDFの色付き語句を自動検出してSRSで暗記",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#fffdf7",
        theme_color: "#d4a373",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,mjs}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // cMaps + standard fonts are cached on first use (avoids precaching ~170 files).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/pdfjs/"),
            handler: "CacheFirst",
            options: {
              cacheName: "pdfjs-assets",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
