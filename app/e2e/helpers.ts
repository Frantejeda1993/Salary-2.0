/** Datos de prueba: un fichero sintético del repo (nunca datos reales) cargado en el Firestore simulado. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

type Raw = Record<string, unknown>;
const ref = JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures/reference/synthetic-002.json", import.meta.url)), "utf8")) as {
  dataset: { docs: Record<string, Record<string, Raw>>; profile: { settings: Raw } };
};

export const UID = "mock-uid";

export function seedStore(opts: { tourDone?: boolean; extra?: Record<string, Raw> } = {}) {
  const store: Record<string, Raw> = {};
  for (const [c, docs] of Object.entries(ref.dataset.docs)) for (const [id, d] of Object.entries(docs)) store[`users/${UID}/${c}/${id}`] = d;
  store[`users/${UID}`] = {
    displayName: "Demo", onboardingDone: true, tourDone: opts.tourDone ?? true,
    settings: { ...ref.dataset.profile.settings, timezone: "Europe/Madrid", currency: "EUR", locale: "es-ES" },
  };
  const main = ref.dataset.profile.settings.mainAccountId as string;
  const cat = Object.keys(ref.dataset.docs.categories)[0];
  store[`users/${UID}/movements/e2e1`] = { type: "expense", date: "2026-10-05", amount: 42.3, description: "Mercadona", categoryId: cat, accountId: main };
  Object.assign(store, opts.extra ?? {});
  return store;
}

/** Abre la app con sesión iniciada y los datos sembrados (solo la primera carga de la pestaña). */
export async function openApp(page: Page, opts: Parameters<typeof seedStore>[0] = {}, hash = "#/") {
  const store = seedStore(opts);
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("salary-mock-firestore", JSON.stringify(s));
    localStorage.setItem("salary-mock-auth-user", JSON.stringify({ uid: "mock-uid", email: "demo@example.com", displayName: "Demo" }));
    sessionStorage.setItem("e2e-seeded", "1");
  }, store);
  await page.goto(hash);
}

/** Va a una pestaña y espera a que la pantalla nueva esté montada. */
export async function tab(page: Page, name: "Mes" | "Movimientos" | "Plan" | "Ajustes") {
  const cls = { Mes: "t-mes", Movimientos: "t-movimientos", Plan: "t-plan", Ajustes: "t-ajustes" }[name];
  await page.locator(`.tabbar a.${cls}`).click();
  await page.locator(`.screen-head h1, .screen-head h2`).filter({ hasText: name }).first().waitFor();
}
