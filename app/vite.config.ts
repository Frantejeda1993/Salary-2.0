/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// Se publica en https://frantejeda1993.github.io/Salary-2.0/
const BASE = "/Salary-2.0/";
export const engineAlias = { "@salary/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)) };

export default defineConfig({
  base: BASE,
  build: { chunkSizeWarningLimit: 1200 },
  resolve: { alias: engineAlias },
  server: { fs: { allow: [".."] } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Salary",
        short_name: "Salary",
        description: "Tus finanzas del mes: real, proyectado y presupuestos",
        lang: "es",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f1115",
        theme_color: "#0f1115",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
