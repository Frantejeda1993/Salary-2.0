/**
 * Fase 8c: gastos compartidos. Los ejemplos de docs/DISENO-8C.md (Ana y Eva, importes
 * inventados) y la garantía de que sin gastos compartidos ninguna cifra cambia.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_OPTIONS, FinanceCore, engineMetrics, fromDataset, monthRange, type Dataset, type MovementDoc, type SharedLine,
} from "../src";

const MAIN = "main";
const CAT = "comida";

/** Una persona con nómina de 2.000 € en la cuenta principal desde noviembre. */
function person(opts: { movements?: Record<string, MovementDoc>; shared?: SharedLine[]; budget?: number } = {}): Dataset {
  return {
    profile: { settings: { startMonth: "2026-11", mainAccountId: MAIN } },
    docs: {
      accounts: { [MAIN]: { name: "Principal", initialBalance: 0 } },
      categories: { [CAT]: { name: "Comida" } },
      salaries: { s1: { grossMonthly: 2000, start: "2026-11-01", end: null, accountId: MAIN, deductions: [], revisions: [], overtimes: [] } },
      fixedExpenses: {},
      budgets: opts.budget ? { b1: { categoryId: CAT, accountId: MAIN, amount: opts.budget, start: "2026-11-01", end: null } } : {},
      movements: opts.movements ?? {},
      cards: {},
      cardSettlements: {},
    },
    ...(opts.shared ? { shared: opts.shared } : {}),
  };
}

const core = (ds: Dataset, current = "2026-11") => new FinanceCore(fromDataset(ds, { cents: true }), current, "2026-11", CURRENT_OPTIONS);
const proj = (c: FinanceCore, m: string) => c.monthSummary(m).resultado_proyectado / 100;
const real = (c: FinanceCore, m: string) => c.monthSummary(m).resultado_real / 100;

const shopping: MovementDoc = { type: "expense", date: "2026-11-05", amount: 100, categoryId: CAT, accountId: MAIN };
const anaLine: SharedLine = { id: "g1", month: "2026-11", paidByMe: true, movementId: "m1", ownPart: 50, otherPart: 50, categoryId: CAT };
const evaLine: SharedLine = { id: "g1", month: "2026-11", paidByMe: false, movementId: null, ownPart: 50, otherPart: 50, categoryId: CAT };
const settle = (dir: "paid" | "received", amount: number, date = "2026-11-20"): MovementDoc => ({
  type: "transfer", date, amount, transferKind: "sharedSettlement",
  accountId: dir === "paid" ? MAIN : null, toAccountId: dir === "paid" ? null : MAIN,
});

describe("8c · Ana paga 100 € a medias con Eva", () => {
  it("Ana: el dinero salió entero; su categoría cuenta solo su parte", () => {
    const c = core(person({ movements: { m1: shopping }, shared: [anaLine] }));
    expect(real(c, "2026-11")).toBe(1900);
    expect(proj(c, "2026-11")).toBe(1900);
    expect(c.rawCategoryExpenses("2026-11", MAIN).get(CAT)).toBe(5000);
    expect(c.sharedPosition("2026-11")).toEqual({ neto: -5000, debes: 0, te_deben: 5000 });
  });

  it("Eva: no sale dinero, pero su parte resta de la previsión y cuenta en su categoría", () => {
    const c = core(person({ shared: [evaLine] }));
    expect(real(c, "2026-11")).toBe(2000);
    expect(proj(c, "2026-11")).toBe(1950);
    expect(c.rawCategoryExpenses("2026-11", MAIN).get(CAT)).toBe(5000);
    expect(c.sharedPosition("2026-11").debes).toBe(5000);
    expect(c.projectedBalance(MAIN, "2026-11").resultado).toBe(195000);
  });

  it("Eva paga 30 €: el real de los dos cambia; la previsión de Eva no", () => {
    const ana = core(person({ movements: { m1: shopping, p1: settle("received", 30) }, shared: [anaLine] }));
    expect(real(ana, "2026-11")).toBe(1930);
    expect(proj(ana, "2026-11")).toBe(1930);
    expect(ana.sharedPosition("2026-11").te_deben).toBe(2000);

    const eva = core(person({ movements: { p1: settle("paid", 30) }, shared: [evaLine] }));
    expect(real(eva, "2026-11")).toBe(1970);
    expect(proj(eva, "2026-11")).toBe(1950);
    expect(eva.sharedPosition("2026-11").debes).toBe(2000);
  });

  it("en diciembre se arrastran los 20 € pendientes", () => {
    const eva = core(person({ movements: { p1: settle("paid", 30) }, shared: [evaLine] }), "2026-12");
    expect(real(eva, "2026-12")).toBe(1970 + 2000);
    expect(proj(eva, "2026-12")).toBe(1950 + 2000);
    expect(eva.monthProjectedResult(MAIN, "2026-12", eva.monthSummary("2026-12").remaining_from_previous_month).deuda_compartida_arrastrada).toBe(2000);
    // Paga los 20 € en diciembre: el real baja, la previsión no se mueve; en enero ya no hay deuda.
    const paid = core(person({ movements: { p1: settle("paid", 30), p2: settle("paid", 20, "2026-12-03") }, shared: [evaLine] }), "2026-12");
    expect(proj(paid, "2026-12")).toBe(1950 + 2000);
    expect(paid.sharedPosition("2026-12").neto).toBe(0);

    const ana = core(person({ movements: { m1: shopping, p1: settle("received", 30) }, shared: [anaLine] }), "2026-12");
    expect(proj(ana, "2026-12")).toBe(1930 + 2000);
  });

  it("meses futuros: la deuda resta una sola vez", () => {
    const eva = core(person({ shared: [evaLine] }));
    expect(proj(eva, "2026-12")).toBe(1950 + 2000);
    expect(eva.projectedBalance(MAIN, "2026-12").resultado).toBe(395000);
    const ana = core(person({ movements: { m1: shopping }, shared: [anaLine] }));
    expect(proj(ana, "2026-12")).toBe(1900 + 2000);
  });
});

describe("8c · budgets", () => {
  it("la parte de Eva cabe en su budget: no resta dos veces", () => {
    expect(proj(core(person({ shared: [evaLine], budget: 200 })), "2026-11")).toBe(1800);
  });
  it("Ana reserva su budget entero y además lo adelantado a Eva", () => {
    const c = core(person({ movements: { m1: shopping }, shared: [anaLine], budget: 200 }));
    expect(proj(c, "2026-11")).toBe(1750);
    expect(c.projectedBalance(MAIN, "2026-11").resultado).toBe(175000);
    const bd = c.monthProjectedResult(MAIN, "2026-11", 0).budget_details[0];
    expect(bd.real_spent).toBe(5000);
  });
});

describe("8c · los dos pagan cosas: las deudas se compensan", () => {
  // Ana paga 100 (Eva debe 50); Eva paga 60 (Ana debe 30). Neto: Eva debe 20.
  const evaShop: MovementDoc = { type: "expense", date: "2026-11-08", amount: 60, categoryId: CAT, accountId: MAIN };
  it("Ana: salen 100 €; no cuenta los 20 € que le deben", () => {
    const c = core(person({ movements: { m1: shopping }, shared: [anaLine,
      { id: "g2", month: "2026-11", paidByMe: false, movementId: null, ownPart: 30, otherPart: 30, categoryId: CAT }] }));
    expect(proj(c, "2026-11")).toBe(1900);
    expect(c.rawCategoryExpenses("2026-11", MAIN).get(CAT)).toBe(8000);
    expect(c.sharedPosition("2026-11")).toEqual({ neto: -2000, debes: 0, te_deben: 2000 });
  });
  it("Eva: salen 60 € y debe 20: su parte total es 80", () => {
    const c = core(person({ movements: { e1: evaShop }, shared: [
      { id: "g1", month: "2026-11", paidByMe: false, movementId: null, ownPart: 50, otherPart: 50, categoryId: CAT },
      { id: "g2", month: "2026-11", paidByMe: true, movementId: "e1", ownPart: 30, otherPart: 30, categoryId: CAT }] }));
    expect(proj(c, "2026-11")).toBe(1920);
    expect(c.projectedBalance(MAIN, "2026-11").resultado).toBe(192000);
  });
});

describe("8c · casos de borde", () => {
  it("lo pagué yo y aún no dije con qué: cuenta como si ya hubiera salido (la caja real no cambia)", () => {
    const c = core(person({ shared: [{ ...anaLine, movementId: null }] }));
    expect(real(c, "2026-11")).toBe(2000);
    expect(proj(c, "2026-11")).toBe(1900);
  });
  it("con tarjeta: cuenta en el mes en que se descuenta la compra", () => {
    const card: MovementDoc = { ...shopping, card: { cardId: "v", chargeMonth: "2026-12", reserveIn: "purchase" } };
    const c = core(person({ movements: { m1: card }, shared: [anaLine] }));
    expect(proj(c, "2026-11")).toBe(1900);
    expect(c.rawCategoryExpenses("2026-11", MAIN).get(CAT)).toBe(5000);
  });
  it("el movimiento se borró: vuelve a contar como pendiente de registrar", () => {
    const c = core(person({ shared: [anaLine] }));
    expect(proj(c, "2026-11")).toBe(1900);
  });
});

describe("8c · sin gastos compartidos no cambia ninguna cifra", () => {
  const DIR = join(__dirname, "..", "..", "fixtures", "reference");
  for (const f of readdirSync(DIR).filter((x) => /^synthetic-\d+\.json$/.test(x)).sort()) {
    it(f, () => {
      const ref = JSON.parse(readFileSync(join(DIR, f), "utf-8")) as { dataset: Dataset; cases: { currentMonth: string; startMonth: string; months: [string, string] }[] };
      for (const c of ref.cases) {
        const months = monthRange(c.months[0], c.months[1]);
        const without = engineMetrics(fromDataset(ref.dataset, { cents: true }), c.currentMonth, c.startMonth, months, CURRENT_OPTIONS);
        const withEmpty = engineMetrics(fromDataset({ ...ref.dataset, shared: [] }, { cents: true }), c.currentMonth, c.startMonth, months, CURRENT_OPTIONS);
        expect([...withEmpty]).toEqual([...without]);
      }
    });
  }
});
