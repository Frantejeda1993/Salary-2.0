import { describe, expect, it } from "vitest";
import { FIXED_KEY, OTHER_KEY, spendingSlices } from "../src/lib/spending";

const names = (id: string) => ({ c: "Comida", g: "Gasolina", o: "Ocio", x: "Extra", h: "Casa", z: "Ropa", k: "Kiosco" }[id] ?? id);

describe("gasto por categoría", () => {
  it("suma movimientos y fijos pagados, y ordena de mayor a menor", () => {
    const r = spendingSlices(new Map([["c", 30000], ["g", 8000], ["", 1000]]), [{ categoryId: "h", cents: 70000 }, { categoryId: null, cents: 5000 }, { categoryId: "c", cents: 2000 }], names);
    expect(r.slices.map((s) => [s.name, s.cents])).toEqual([["Casa", 70000], ["Comida", 32000], ["Gasolina", 8000], ["Gastos fijos sin categoría", 5000], ["Sin categoría", 1000]]);
    expect(r.total).toBe(116000);
    expect(r.slices.find((s) => s.key === FIXED_KEY)).toBeTruthy();
  });
  it("una categoría en negativo por devoluciones no entra", () => {
    expect(spendingSlices(new Map([["c", -500], ["g", 100]]), [], names).slices.map((s) => s.key)).toEqual(["g"]);
  });
  it("más de 6: las pequeñas van a «Otras»", () => {
    const raw = new Map([["c", 700], ["g", 600], ["o", 500], ["x", 400], ["h", 300], ["z", 200], ["k", 100]]);
    const r = spendingSlices(raw, [], names);
    expect(r.slices).toHaveLength(6);
    expect(r.slices[5]).toEqual({ key: OTHER_KEY, name: "Otras (2)", cents: 300 });
    expect(r.hidden.map((s) => s.name)).toEqual(["Ropa", "Kiosco"]);
  });
});
