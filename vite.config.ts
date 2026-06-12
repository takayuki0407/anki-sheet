/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Short build id (YYMMDD-HHMM) stamped into the bundle so the UI can report which
// deploy is actually running on a device — invaluable for diagnosing stale SW caches.
const d = new Date();
const p = (n: number) => String(n).padStart(2, "0");
const BUILD_ID = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;

// Base is absolute "/" so client-side routes (/, /service, /price, /app/…) load assets from the
// site root regardless of the current path depth. The app is served at the domain root on Pages.
export default defineConfig({
  base: "/",
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Emit sourcemaps so a minified production stack trace (e.g. from an iPhone) can be
  // mapped back to source locally with the dist/*.map files.
  build: { sourcemap: true },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Kiokumate",
        short_name: "Kiokumate",
        lang: "ja",
        description: "隠して覚え、解いて確かめる。色付き答えのPDFを取り込むと、答えを自動で検出して隠せる暗記ツール",
        start_url: "/",
        scope: "/",
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
        // SPA routing: serve the cached app shell for client routes (/, /service, /price, /app/…),
        // but never for the API or the standalone legal pages (privacy.html / terms.html).
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /\.html$/],
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
    include: ["src/**/*.test.ts", "functions/**/*.test.ts"],
  },
});
