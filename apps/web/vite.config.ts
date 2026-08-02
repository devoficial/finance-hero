import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const certificatePath = process.env.FINANCE_HERO_WEB_CERT;
const keyPath = process.env.FINANCE_HERO_WEB_KEY;
const https =
  certificatePath && keyPath
    ? {
        cert: readFileSync(certificatePath),
        key: readFileSync(keyPath),
      }
    : undefined;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "finance-hero.svg",
        "finance-hero-maskable.svg",
        "finance-hero-192.png",
        "finance-hero-512.png",
        "apple-touch-icon.png",
        "favicon-32.png",
      ],
      devOptions: {
        enabled: true,
        type: "module",
      },
      manifest: {
        id: "/",
        name: "Finance Hero",
        short_name: "Finance Hero",
        description: "Private, local-first personal finance control room.",
        theme_color: "#f1eee5",
        background_color: "#f1eee5",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/finance-hero-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/finance-hero-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/finance-hero-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
      },
    }),
  ],
  server: {
    host: process.env.FINANCE_HERO_WEB_HOST ?? "127.0.0.1",
    https,
    port: 4318,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
