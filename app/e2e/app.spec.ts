/**
 * Recorridos reales por la app: que cada pantalla y cada hoja se abra, responda y guarde.
 * Nacieron del bloqueo de las hojas del 26-oct-2026: los tests unitarios no lo vieron.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, tab } from "./helpers";

const sheet = (page: Page) => page.locator(".sheet");

/** Ninguna hoja abierta y la pantalla de detrás sin bloquear. */
async function expectClosed(page: Page) {
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".content[inert], .tabbar[inert]")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  (page as unknown as { __errors: string[] }).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test("Mes: carga, resumen, gasto por categoría y meses", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".closing .figure")).toBeVisible();
  await page.locator(".hero-btn").click();
  await expect(sheet(page).locator(".donut")).toBeVisible();
  await sheet(page).locator(".legend .what.plain").first().click();
  await page.keyboard.press("Escape");
  await expectClosed(page);
  await page.getByRole("button", { name: "Mes siguiente" }).click();
  await expect(page.locator(".today-chip")).toBeVisible();
  await page.locator(".today-chip").click();
  await expect(page.locator(".today-chip")).toHaveCount(0);
});

test("Mes: pagar un gasto fijo con otro importe y deshacer", async ({ page }) => {
  await openApp(page);
  await page.locator(".fold > summary", { hasText: "Por hacer" }).click();
  await page.locator(".fold[open] .rows .what.plain:not([disabled])").first().click();
  await sheet(page).locator(".big-amount input").fill("10");
  await sheet(page).locator(".save").click();
  await expectClosed(page);
  await expect(page.locator(".toast")).toBeVisible();
});

test("Alta rápida: guardar un gasto y verlo en Movimientos", async ({ page }) => {
  await openApp(page);
  await page.locator(".tabbar .add").click();
  await sheet(page).locator(".big-amount input").fill("7,35");
  await sheet(page).locator("input.input").first().fill("Panadería e2e");
  await sheet(page).locator(".save").click();
  await expectClosed(page);
  await tab(page, "Movimientos");
  await expect(page.locator(".rows").getByText("Panadería e2e")).toBeVisible();
});

test("Atajo: #/nuevo abre el gasto rellenado", async ({ page }) => {
  await openApp(page, {}, "#/nuevo?importe=12%2C50&comercio=Bar%20e2e");
  await expect(sheet(page).locator(".big-amount input")).toHaveValue("12,50");
  await expect(sheet(page).locator("input.input").first()).toHaveValue("Bar e2e");
});

test("Movimientos: filtros y editar un movimiento", async ({ page }) => {
  await openApp(page);
  await tab(page, "Movimientos");
  await page.locator(".filter-btn").click();
  await page.locator(".filters").getByText("Entre fechas").click();
  await page.locator(".filters").getByText("Por mes").click();
  await page.locator(".rows .what.plain").first().click();
  await sheet(page).locator("input.input").first().fill("Editado e2e");
  await sheet(page).locator(".save").click();
  await expectClosed(page);
  await expect(page.locator(".rows").getByText("Editado e2e")).toBeVisible();
});

test("Plan: fichas de nómina y gasto fijo", async ({ page }) => {
  await openApp(page);
  await tab(page, "Plan");
  await page.locator(".fold > summary", { hasText: "Nómina" }).click();
  await page.locator(".fold[open] .rows .what.plain").first().click();
  await expect(sheet(page).locator(".calc")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Añadir" }).first().click();
  await sheet(page).getByRole("button", { name: "Volver a la ficha" }).click();
  await page.keyboard.press("Escape");
  await expectClosed(page);
  await page.locator(".fold > summary", { hasText: "Gastos fijos" }).click();
  await page.locator(".fold[open] .rows .what.plain").nth(1).click();
  await sheet(page).locator(".inline-field select").selectOption({ index: 1 });
  await expect(page.locator(".toast")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectClosed(page);
});

test("Ajustes: categoría, cuenta y tarjeta", async ({ page }) => {
  await openApp(page);
  await tab(page, "Ajustes");
  await page.locator(".fold > summary", { hasText: "Categorías" }).click();
  await page.locator(".fold[open] .rows .what.plain").first().click();
  await sheet(page).locator("input.input").fill("Categoría e2e");
  await sheet(page).locator(".check input").check();
  await sheet(page).locator(".save").click();
  await expectClosed(page);
  await expect(page.locator(".rows").getByText("Categoría e2e")).toBeVisible();

  await page.locator(".fold > summary", { hasText: "Cuentas" }).click();
  await page.locator(".fold[open] .rows .what.plain", { hasText: "tarjeta" }).first().click();
  await sheet(page).locator(".changes .rows .what.plain").first().click();
  await expect(sheet(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectClosed(page);
});

test("Tour: aparece la primera vez y se puede saltar", async ({ page }) => {
  await openApp(page, { tourDone: false });
  await expect(page.locator(".tour-card")).toBeVisible();
  await page.locator(".tour-card").getByRole("button", { name: "Saltar" }).click();
  await expect(page.locator(".tour-card")).toHaveCount(0);
});

test("Hoja abierta: el foco no sale de ella", async ({ page }) => {
  await openApp(page);
  await page.locator(".tabbar .add").click();
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement?.closest(".sheet") || document.activeElement === document.body);
  expect(inside).toBe(true);
});
