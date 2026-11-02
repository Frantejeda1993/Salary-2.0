import { describe, expect, it } from "vitest";
import {
  balanceText, currentBalance, engineLines, guessCategory, incomeDocId, incomeMonthsNeeded, itemView, monthView, splitCents, splitError,
  type SharedContext, type SharedDoc, type SettlementDoc, type WithId,
} from "../src/lib/shared";

const A = "ana";
const E = "eva";
const doc = (o: Partial<SharedDoc> & { id: string }): WithId<SharedDoc> =>
  ({ date: "2026-11-05", description: "Súper", amount: 100, paidBy: A, createdBy: A, split: { mode: "equal" }, ...o });
const pay = (o: Partial<SettlementDoc> & { id: string }): WithId<SettlementDoc> =>
  ({ date: "2026-11-20", amount: 30, from: E, to: A, status: "confirmed", ...o });

function ctx(me: string, o: Partial<SharedContext> = {}): SharedContext {
  return {
    me, partner: me === A ? E : A, pairId: "p1", shared: [], settlements: [], incomes: {}, links: {}, movements: {},
    currentMonth: "2026-11", ...o,
  };
}

describe("reparto", () => {
  it("a medias, porcentaje y céntimos: la diferencia de redondeo va a quien pagó", () => {
    expect(splitCents(10000, { mode: "equal" }, [A, E], A).parts).toEqual({ [A]: 5000, [E]: 5000 });
    expect(splitCents(1001, { mode: "equal" }, [A, E], A).parts).toEqual({ [A]: 500, [E]: 501 });
    expect(splitCents(1001, { mode: "equal" }, [A, E], E).parts).toEqual({ [E]: 500, [A]: 501 });
    expect(splitCents(10000, { mode: "percent", percent: { [A]: 60, [E]: 40 } }, [A, E], A).parts).toEqual({ [A]: 6000, [E]: 4000 });
  });

  it("por ingresos del mes (ejemplo del diseño: 2.000 y 1.000)", () => {
    const r = splitCents(10000, { mode: "income" }, [A, E], A, { [A]: 200000, [E]: 100000 }, false);
    expect(r.parts).toEqual({ [A]: 6667, [E]: 3333 });
    expect(r.provisional).toBe(true);
    // Eva cobra 500 € más el día 20: el reparto de todo el mes cambia.
    expect(splitCents(10000, { mode: "income" }, [A, E], A, { [A]: 200000, [E]: 150000 }).parts).toEqual({ [A]: 5714, [E]: 4286 });
  });

  it("por ingresos sin datos de alguno: a medias y avisado", () => {
    const r = splitCents(10000, { mode: "income" }, [A, E], A, { [A]: 200000 });
    expect(r.parts[E]).toBe(5000);
    expect(r.missingIncome).toBe(true);
  });

  it("valida porcentajes", () => {
    expect(splitError({ mode: "percent", percent: { [A]: 60, [E]: 40 } }, [A, E])).toBeNull();
    expect(splitError({ mode: "percent", percent: { [A]: 60, [E]: 30 } }, [A, E])).toMatch(/sumar 100/);
    expect(splitError({ mode: "percent", percent: { [A]: 120, [E]: -20 } }, [A, E])).toMatch(/entre 0 y 100/);
  });
});

describe("saldo de la pareja (ejemplo del diseño)", () => {
  const shared = [doc({ id: "g1" })];
  it("Ana pagó 100 € a medias: Eva le debe 50; tras pagar 30, 20; se arrastra a diciembre", () => {
    const ana = ctx(A, { shared });
    expect(monthView(ana, "2026-11").balance).toBe(-5000);
    expect(balanceText(-5000, "Eva", (c) => `${c / 100} €`)).toBe("Eva te debe 50 €");
    const paid = ctx(A, { shared, settlements: [pay({ id: "s1" })] });
    expect(monthView(paid, "2026-11").balance).toBe(-2000);
    expect(monthView(paid, "2026-12").carried).toBe(-2000);
    const eva = ctx(E, { shared, settlements: [pay({ id: "s1" })] });
    expect(monthView(eva, "2026-12").carried).toBe(2000);
    expect(currentBalance(eva)).toBe(2000);
  });

  it("los pagos sin confirmar no cuentan", () => {
    const c = ctx(A, { shared, settlements: [pay({ id: "s1", status: "pending" }), pay({ id: "s2", status: "rejected" })] });
    expect(monthView(c, "2026-11").balance).toBe(-5000);
    expect(monthView(c, "2026-11").pending.map((s) => s.id)).toEqual(["s1"]);
  });

  it("los dos pagan cosas: se compensa", () => {
    const c = ctx(A, { shared: [doc({ id: "g1" }), doc({ id: "g2", amount: 60, paidBy: E, createdBy: E })] });
    expect(monthView(c, "2026-11").balance).toBe(-2000);
    expect(monthView(c, "2026-11").mineTotal).toBe(8000);
  });
});

describe("lo que ve el motor", () => {
  it("Ana: su movimiento enlazado; Eva: su categoría", () => {
    const shared = [doc({ id: "g1", categoryName: "Comida" })];
    const ana = ctx(A, { shared, links: { g1: { pairId: "p1", categoryId: "c-ana", movementId: "m1" } },
      movements: { m1: { type: "expense", amount: 100 } } });
    expect(engineLines(ana)).toEqual([{ id: "g1", month: "2026-11", paidByMe: true, movementId: "m1", ownPart: 50, otherPart: 50, categoryId: "c-ana" }]);
    const eva = ctx(E, { shared, categories: { c1: { name: "comida " }, c2: { name: "Ocio" } } });
    expect(engineLines(eva)[0]).toMatchObject({ paidByMe: false, movementId: null, ownPart: 50, categoryId: "c1" });
  });

  it("lo pagué yo pero no dije con qué (o borré el movimiento): pendiente de registrar", () => {
    const shared = [doc({ id: "g1", paidBy: A, createdBy: E })];
    expect(itemView(ctx(A, { shared }), shared[0]).needsPayment).toBe(true);
    const gone = ctx(A, { shared, links: { g1: { pairId: "p1", categoryId: null, movementId: "m9" } } });
    expect(itemView(gone, shared[0]).needsPayment).toBe(true);
    expect(engineLines(gone)[0].movementId).toBeNull();
  });

  it("aviso si el importe compartido ya no coincide con mi movimiento", () => {
    const shared = [doc({ id: "g1", amount: 45 })];
    const c = ctx(A, { shared, links: { g1: { pairId: "p1", categoryId: null, movementId: "m1" } }, movements: { m1: { type: "expense", amount: 40 } } });
    expect(itemView(c, shared[0]).amountMismatch).toBe(4000);
  });

  it("ingresos: qué meses publicar y de dónde leerlos", () => {
    expect(incomeMonthsNeeded([doc({ id: "a", split: { mode: "income" } }), doc({ id: "b", date: "2026-10-02", split: { mode: "income" } }), doc({ id: "c" })]))
      .toEqual(["2026-10", "2026-11"]);
    const c = ctx(A, { shared: [doc({ id: "g1", split: { mode: "income" } })],
      incomes: { [incomeDocId(A, "2026-11")]: { uid: A, month: "2026-11", total: 2000 }, [incomeDocId(E, "2026-11")]: { uid: E, month: "2026-11", total: 1000 } } });
    expect(monthView(c, "2026-11").items[0].theirs).toBe(3333);
  });

  it("categoría de igual nombre", () => {
    expect(guessCategory("Comida", { x: { name: "COMIDA" } })).toBe("x");
    expect(guessCategory("Comida", { x: { name: "Comida", archived: true } })).toBeNull();
    expect(guessCategory(null, { x: { name: "Comida" } })).toBeNull();
  });
});
