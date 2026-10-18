import { describe, expect, it } from "vitest";
import { matches, isFiltering, NO_CATEGORY, type MovFilter } from "../src/lib/movfilter";

const names = {
  accounts: { a1: { name: "Principal" }, a2: { name: "Ahorro" } },
  categories: { c1: { name: "Gasolina" }, c2: { name: "Comida" } },
  cards: { k1: { name: "Visa Oro" } },
};
const movs = {
  m1: { type: "expense", date: "2026-10-03", amount: 50, description: "Repsol", categoryId: "c1", accountId: "a1" },
  m2: { type: "expense", date: "2026-09-28", amount: 20, description: "Mercadona", categoryId: "c2", accountId: "a1", card: { cardId: "k1" } },
  m3: { type: "transfer", date: "2026-10-10", amount: 100, description: "", accountId: "a1", toAccountId: "a2" },
  m4: { type: "expense", date: "2026-10-12", amount: 5, description: "Café", categoryId: null, accountId: "a2" },
};
const run = (f: Partial<MovFilter>) =>
  Object.entries(movs).filter(([, m]) => matches(m, { text: "", categoryId: "", accountId: "", ...f }, names)).map(([id]) => id);

describe("búsqueda de movimientos", () => {
  it("por mes", () => expect(run({ month: "2026-10" })).toEqual(["m1", "m3", "m4"]));
  it("por rango, con extremos incluidos y sin límite si falta uno", () => {
    expect(run({ from: "2026-09-28", to: "2026-10-03" })).toEqual(["m1", "m2"]);
    expect(run({ from: "2026-10-10" })).toEqual(["m3", "m4"]);
    expect(run({})).toHaveLength(4);
  });
  it("por categoría y sin categoría", () => {
    expect(run({ categoryId: "c1" })).toEqual(["m1"]);
    expect(run({ categoryId: NO_CATEGORY })).toEqual(["m4"]);
  });
  it("por cuenta: origen o destino", () => expect(run({ accountId: "a2" })).toEqual(["m3", "m4"]));
  it("el texto busca en concepto, categoría, cuenta y tarjeta, sin tildes", () => {
    expect(run({ text: "gasolina" })).toEqual(["m1"]);
    expect(run({ text: "visa" })).toEqual(["m2"]);
    expect(run({ text: "ahorro" })).toEqual(["m3", "m4"]);
    expect(run({ text: "cafe" })).toEqual(["m4"]);
  });
  it("filtros combinados", () => expect(run({ month: "2026-10", accountId: "a1", categoryId: "c1" })).toEqual(["m1"]));
  it("sabe si hay filtro activo", () => {
    expect(isFiltering({ text: "", categoryId: "", accountId: "", month: "2026-10" })).toBe(false);
    expect(isFiltering({ text: "", categoryId: "", accountId: "" })).toBe(true);
  });
});
