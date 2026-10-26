import { describe, expect, it } from "vitest";
import { compareFill, deltaText, fillFigures, fuelHistory, isFuelCategory, parseFuel, parseFuelNumber, suggestedPrice } from "../src/lib/fuel";

const movs = {
  a: { type: "expense", date: "2026-08-01", amount: 60, description: "Repsol", categoryId: "g", fuel: { km: 600, pricePerLiter: 1.5 } },     // 40 L, 6,67 L/100
  b: { type: "expense", date: "2026-09-01", amount: 64, description: "Shell", categoryId: "g", fuel: { km: 640, pricePerLiter: 1.6 } },      // 40 L, 6,25
  c: { type: "expense", date: "2026-10-01", amount: 45, description: "repsol ", categoryId: "g", fuel: { km: 0, pricePerLiter: 1.5 } },      // sin km
  x: { type: "expense", date: "2026-10-02", amount: 9, description: "Pan", categoryId: "c" },
};

describe("combustible", () => {
  it("cifras de un repostaje", () => {
    const f = fillFigures(60, 600, 1.5);
    expect(f.liters).toBe(40);
    expect(f.lPer100).toBeCloseTo(6.667, 3);
    expect(f.eurPerKm).toBeCloseTo(0.1, 6);
    expect(fillFigures(60, 0, 1.5).lPer100).toBeNull();
  });
  it("historial ordenado, solo con precio", () => {
    expect(fuelHistory(movs).map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(fuelHistory(movs, "b").map((f) => f.id)).toEqual(["a", "c"]);
  });
  it("categoría de combustible: manda la marca; si no hay marca, lo es si ya tiene repostajes", () => {
    const cats = { g: { name: "Gasolina" }, c: { name: "Comida" }, k: { name: "Coche", isFuel: true }, n: { name: "Gas", isFuel: false } };
    expect(isFuelCategory("g", cats, movs)).toBe(true);
    expect(isFuelCategory("c", cats, movs)).toBe(false);
    expect(isFuelCategory("k", cats, movs)).toBe(true);
    expect(isFuelCategory("n", { ...cats, g: { name: "G", isFuel: false } }, movs)).toBe(false);
  });
  it("precio sugerido: el de esa gasolinera (sin mayúsculas ni espacios) o el último", () => {
    const h = fuelHistory(movs);
    expect(suggestedPrice(h, "Shell")).toBe(1.6);
    expect(suggestedPrice(h, "REPSOL")).toBe(1.5);
    expect(suggestedPrice(h, "Galp")).toBe(1.5);
    expect(suggestedPrice([], "Galp")).toBeNull();
  });
  it("comparación con la media de los últimos con km", () => {
    const c = compareFill(70, 700, 1.4, fuelHistory(movs));
    expect(c.liters).toBe(50);
    expect(c.lPer100).toBeCloseTo(7.143, 3);
    expect(c.avg.n).toBe(2);
    expect(c.avg.lPer100).toBeCloseTo((6.6667 + 6.25) / 2, 3);
    expect(c.avg.price).toBeCloseTo((1.5 + 1.6 + 1.5) / 3, 6);
    expect(c.last?.id).toBe("c");
  });
  it("textos de diferencia", () => {
    expect(deltaText(6.0, 6.45, "l100")).toEqual({ text: "0,5 L/100 km menos", better: true });
    expect(deltaText(1.53, 1.5, "price")).toEqual({ text: "3 cént. más por litro", better: false });
    expect(deltaText(1.5, 1.502, "price")?.text).toBe("mismo precio por litro");
  });
  it("números de repostaje", () => {
    expect(parseFuelNumber("1,539", "price")).toBe(1.539);
    expect(parseFuelNumber("1.539 €", "price")).toBe(1.539);
    expect(parseFuelNumber("1.050", "km")).toBe(1050);
    expect(parseFuelNumber("612,5 km", "km")).toBe(612.5);
    expect(parseFuelNumber("abc", "km")).toBeNull();
  });
  it("lee el formulario", () => {
    expect(parseFuel("", "")).toBeNull();
    expect(parseFuel("612", "1,539")).toEqual({ km: 612, pricePerLiter: 1.539 });
    expect(parseFuel("", "1,5")).toEqual({ km: 0, pricePerLiter: 1.5 });
    expect(parseFuel("600", "")).toBe("invalid");
  });
});

describe("reconocer gasolineras por el nombre", async () => {
  const { looksLikeFuelStation, guessFuelCategory } = await import("../src/lib/fuel");
  it("marcas y palabras completas", () => {
    expect(looksLikeFuelStation("REPSOL AV. MADRID 12")).toBe(true);
    expect(looksLikeFuelStation("Estación de Servicio La Paz")).toBe(true);
    expect(looksLikeFuelStation("BP Oil")).toBe(true);
    expect(looksLikeFuelStation("Bpo Seguros")).toBe(false);
    expect(looksLikeFuelStation("Mercadona")).toBe(false);
  });
  it("propone la categoría de combustible más usada últimamente", async () => {
    const { fuelCategoriesByUse } = await import("../src/lib/fuel");
    expect(guessFuelCategory("Galp", ["g"])).toBe("g");
    expect(guessFuelCategory("Zara", ["g"])).toBeNull();
    expect(guessFuelCategory("Galp", [])).toBeNull();
    const m = { a: { type: "expense", date: "2026-01-01", categoryId: "h" }, b: { type: "expense", date: "2026-05-01", categoryId: "g" } };
    expect(fuelCategoriesByUse(["h", "g", "k"], m)).toEqual(["g", "h", "k"]);
  });
});
