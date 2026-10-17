// Modo de prueba: la app con Firebase simulado y datos en el navegador (localStorage).
// Uso: npm run dev:mock   — nunca toca tu Firebase real.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const mock = (f: string) => fileURLToPath(new URL(`./mocks/${f}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  define: { "import.meta.env.VITE_MOCK": JSON.stringify("1") },
  resolve: {
    alias: {
      "@salary/engine": fileURLToPath(new URL("../../engine/src/index.ts", import.meta.url)),
      "firebase/app": mock("firebase-app.js"),
      "firebase/auth": mock("firebase-auth.js"),
      "firebase/firestore": mock("firebase-firestore.js"),
    },
  },
  server: { fs: { allow: ["../.."] } },
  plugins: [react()],
});
