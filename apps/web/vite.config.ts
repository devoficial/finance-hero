import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["finance-hero.svg"],
      manifest: {
        name: "Finance Hero",
        short_name: "Finance Hero",
        description: "Private, local-first personal finance control room.",
        theme_color: "#f1eee5",
        background_color: "#f1eee5",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/finance-hero.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 4318,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
