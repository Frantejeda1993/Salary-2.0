import { describe, expect, it } from "vitest";
import { budgetLevel, groupByBank } from "../src/lib/format";

describe("cuentas por banco", () => {
  it("agrupa por banco respetando el orden y deja aparte las que no tienen banco", () => {
    const g = groupByBank([
      ["a", { name: "Principal", bankName: "BBVA" }], ["b", { name: "Mio", bankName: "Trade Republic" }],
      ["c", { name: "Ahorro", bankName: " BBVA " }], ["d", { name: "Efectivo", bankName: "" }],
    ]);
    expect(g.map((x) => [x.bank, x.accounts.map(([id]) => id)])).toEqual([
      ["BBVA", ["a", "c"]], ["Trade Republic", ["b"]], ["Sin banco", ["d"]]]);
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
