import { describe, expect, it } from "vitest";
import { budgetLevel, groupByBank } from "../src/lib/format";

describe("cuentas por banco", () => {
  it("agrupa por banco respetando el orden y deja aparte las que no tienen banco", () => {
    const g = groupByBank([
      ["a", { name: "Principal", bankName: "Banco Uno" }], ["b", { name: "Mio", bankName: "Banco Dos" }],
      ["c", { name: "Ahorro", bankName: " Banco Uno " }], ["d", { name: "Efectivo", bankName: "" }],
    ]);
    expect(g.map((x) => [x.bank, x.accounts.map(([id]) => id)])).toEqual([
      ["Banco Uno", ["a", "c"]], ["Banco Dos", ["b"]], ["Sin banco", ["d"]]]);
  });
});

describe("color de los budgets", () => {
  it("cambia según se llena", () => {
    expect([0, 59, 60, 84, 85, 100, 101].map((u) => budgetLevel(u, 100))).toEqual(
      ["ok", "ok", "mid", "mid", "high", "high", "over"]);
    expect(budgetLevel(0, 0)).toBe("ok");
    expect(budgetLevel(5, 0)).toBe("over");
  });
});
