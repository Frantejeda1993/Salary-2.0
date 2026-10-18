import { describe, expect, it } from "vitest";
import {
  canDeleteFixed, endOfMonth, loanAfterAmountChange, loanAfterRepayment, monthChoices, paymentsAfter, valueInMonth, withRevision,
} from "../src/lib/plan";

describe("revisiones", () => {
  it("añade ordenado por mes y fusiona si ya hay una ese mes", () => {
    type R = { from: string; amount?: number; accountId?: string };
    let r = withRevision<R>([{ from: "2026-05", amount: 10 }], { from: "2026-03", amount: 8 });
    expect(r.map((x) => x.from)).toEqual(["2026-03", "2026-05"]);
    r = withRevision<R>(r, { from: "2026-05", accountId: "b" });
    expect(r[1]).toEqual({ from: "2026-05", amount: 10, accountId: "b" });
  });
  it("no toca el array original", () => {
    const orig = [{ from: "2026-05", amount: 10 }];
    withRevision(orig, { from: "2026-06", amount: 1 });
    expect(orig).toHaveLength(1);
  });
  it("el valor de un mes aplica solo revisiones hasta ese mes", () => {
    const base = { amount: 100, accountId: "a" };
    const revs = [{ from: "2026-06", amount: 120 }, { from: "2026-03", accountId: "b" }];
    expect(valueInMonth(base, revs, "amount", "2026-05")).toBe(100);
    expect(valueInMonth(base, revs, "amount", "2026-06")).toBe(120);
    expect(valueInMonth(base, revs, "accountId", "2026-02")).toBe("a");
    expect(valueInMonth(base, revs, "accountId", "2026-10")).toBe("b");
  });
});

describe("terminar y borrar", () => {
  it("la fecha de fin es el último día del mes", () => {
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2028-02")).toBe("2028-02-29");
    expect(endOfMonth("2026-12")).toBe("2026-12-31");
  });
  it("detecta pagos que quedarían fuera del periodo", () => {
    expect(paymentsAfter({ "2026-09": {}, "2026-11": {}, "2026-10": {} }, "2026-09")).toEqual(["2026-10", "2026-11"]);
    expect(paymentsAfter(undefined, "2026-09")).toEqual([]);
  });
  it("solo se borra un fijo sin pagos", () => {
    expect(canDeleteFixed({ payments: {} })).toBe(true);
    expect(canDeleteFixed({})).toBe(true);
    expect(canDeleteFixed({ payments: { "2026-10": { status: "paid" } } })).toBe(false);
  });
});

describe("préstamos", () => {
  it("cambiar el importe conserva lo devuelto (regla vieja)", () => {
    expect(loanAfterAmountChange(500, 300, 600)).toEqual({ status: "pending", outstanding: 400 });
    expect(loanAfterAmountChange(500, 300, 150)).toEqual({ status: "paid", outstanding: 0 });
    expect(loanAfterAmountChange(43, 20.05, 43.1)).toEqual({ status: "pending", outstanding: 20.15 });
  });
  it("una devolución rebaja el pendiente y deshacerla lo repone, sin pasar del importe", () => {
    expect(loanAfterRepayment(300, 300, 100)).toEqual({ status: "pending", outstanding: 200 });
    expect(loanAfterRepayment(300, 200, 250)).toEqual({ status: "paid", outstanding: 0 });
    expect(loanAfterRepayment(300, 0, -100)).toEqual({ status: "pending", outstanding: 100 });
    expect(loanAfterRepayment(300, 250, -100)).toEqual({ status: "pending", outstanding: 300 });
  });
});

it("meses para elegir alrededor del actual", () => {
  const m = monthChoices("2026-10", 2, 2);
  expect(m).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
});

import { removeRevision, replaceRevision } from "../src/lib/plan";

describe("editar y quitar revisiones", () => {
  type R = { from: string; amount?: number };
  const revs: R[] = [{ from: "2026-03", amount: 10 }, { from: "2026-06", amount: 12 }];
  it("cambia importe y mes, y mantiene el orden", () => {
    expect(replaceRevision(revs, "2026-06", { from: "2026-02", amount: 15 })).toEqual([
      { from: "2026-02", amount: 15 }, { from: "2026-03", amount: 10 }]);
  });
  it("si el mes nuevo ya tenía cambio, lo sustituye", () => {
    expect(replaceRevision(revs, "2026-06", { from: "2026-03", amount: 20 })).toEqual([{ from: "2026-03", amount: 20 }]);
  });
  it("quita una", () => {
    expect(removeRevision(revs, "2026-03")).toEqual([{ from: "2026-06", amount: 12 }]);
    expect(revs).toHaveLength(2);
  });
});
