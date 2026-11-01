// Pruebas de interacción sobre la app en modo prueba (Firebase simulado, datos sintéticos).
// Uso: npm run e2e. En CI se instala Chromium; en local se puede usar otro con PW_CHROMIUM.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5181/Salary-2.0/",
    viewport: { width: 375, height: 740 },
    timezoneId: "Europe/Madrid",
    locale: "es-ES",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: "npx vite --config dev/vite.mock.config.ts --port 5181 --strictPort",
    url: "http://localhost:5181/Salary-2.0/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
