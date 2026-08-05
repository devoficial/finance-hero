import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function staleServiceWorkerCleanup(): Plugin {
  const cleanupWorker = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await self.registration.unregister();
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.allSettled(windows.map((client) => client.navigate(client.url)));
  })());
});
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
`;

  return {
    name: "finance-hero-stale-worker-cleanup",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/sw.js") {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        response.setHeader("Service-Worker-Allowed", "/");
        response.end(cleanupWorker);
      });
    },
  };
}

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
    staleServiceWorkerCleanup(),
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
        enabled: false,
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
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
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
