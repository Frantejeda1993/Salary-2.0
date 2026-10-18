/**
 * Fase 4b: una prueba por corrección acordada, comparando el motor viejo
 * (LEGACY_OPTIONS) con el corregido. Ver el registro de decisiones de la especificación.
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_OPTIONS, FinanceCore, LEGACY_OPTIONS, currentMonthInTimeZone, roundHalfUp, toCents, type EngineOptions,
} from "../src";
import { d, emptyData, toEngine, type Legacy } from "./legacy";

const MAIN = "main";
const EUROS: EngineOptions = { ...CURRENT_OPTIONS, cents: false };
const legacy = (L: Legacy, cur: string) => new FinanceCore(toEngine(L), cur, "2026-02", LEGACY_OPTIONS);
const fixed = (L: Legacy, cur: string) => new FinanceCore(toEngine(L), cur, "2026-02", EUROS);
const cents = (L: Legacy, cur: string) => new FinanceCore(toCents(toEngine(L)), cur, "2026-02", CURRENT_OPTIONS);

function world(): Legacy {
  const data = emptyData();
  data.accounts = [{ id: MAIN, is_main: true, saldo_inicial: 0 }, { id: "sec", is_main: false, saldo_inicial: 0 }];
  data.salaries = [{ id: "s1", account_id: MAIN, salario_bruto: 2000, fecha_inicio: d(2026, 2, 1), fecha_fin: null, deductions: [] }];
  return data;
}

describe("B6 · pagos fuera del periodo del gasto fijo", () => {
  it("se ignoran en el saldo real, como ya se ignoraban en el resultado del mes", () => {
    const data = world();
    data.fixed_expenses = [{ id: "x", account_id: MAIN, monto: 100, fecha_inicio: d(2026, 3, 1), fecha_fin: d(2026, 3, 31) }];
    data.fixed_expense_instances = [
      { fixed_expense_id: "x", mes: "2026-03", estado: "pagado", monto: null },
      { fixed_expense_id: "x", mes: "2026-04", estado: "pagado", monto: null }, // marca errónea
    ];
    expect(legacy(data, "2026-04").realBalance(MAIN, "2026-04")).toBe(3 * 2000 - 200);
    expect(fixed(data, "2026-04").realBalance(MAIN, "2026-04")).toBe(3 * 2000 - 100);
    expect(fixed(data, "2026-04").monthRealResult(MAIN, "2026-04")).toBe(2000);
  });
});

describe("B1 · saldo proyectado de meses futuros", () => {
  const data = () => {
    const w = world();
    w.fixed_expenses = [{ id: "rent", account_id: MAIN, monto: 700, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    w.budgets = [{ id: "b", categoria_id: "food", account_id: MAIN, monto: 300, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    return w;
  };

  it("resta fijos y budgets de los meses intermedios", () => {
    const old = legacy(data(), "2026-04");
    const now = fixed(data(), "2026-04");
    expect(now.projectedBalance(MAIN, "2026-04").resultado).toBe(old.projectedBalance(MAIN, "2026-04").resultado);
    expect(old.projectedBalance(MAIN, "2026-06").resultado).toBe(9000);            // app vieja: inflado
    expect(now.projectedBalance(MAIN, "2026-05").resultado).toBe(5000 + 2000 - 1000);
    expect(now.projectedBalance(MAIN, "2026-06").resultado).toBe(7000);
  });

  it("coincide con el proyectado encadenado de la cuenta principal", () => {
    const now = fixed(data(), "2026-04");
    for (const m of ["2026-05", "2026-06", "2026-09"]) {
      expect(now.projectedBalance(MAIN, m).resultado).toBe(now.monthSummary(m).resultado_proyectado);
    }
  });
});

describe("D3 + A1 · gastos propios", () => {
  const gym = (paid: string[], refunds: [number, number][] = []) => {
    const w = world();
    w.fixed_expenses = [{ id: "gym", account_id: "sec", monto: 50, es_propio: true, fecha_inicio: d(2026, 2, 1), fecha_fin: null }];
    w.fixed_expense_instances = paid.map((m) => ({ fixed_expense_id: "gym", mes: m, estado: "pagado", monto: null }));
    w.transfers = refunds.map(([month, amount]) => ({
      cuenta_origen: MAIN, cuenta_destino: "sec", monto: amount, fecha: d(2026, month, 5), descripcion: "Transferencia automatica gastos",
    }));
    return w;
  };

  it("lo pagado y no reembolsado de meses cerrados sigue pendiente", () => {
    const data = gym(["2026-02", "2026-03"]);
    expect([...legacy(data, "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 50]]);
    expect([...fixed(data, "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 150]]);
  });

  it("lo que no se pagó en un mes cerrado no se debe (D7)", () => {
    expect([...fixed(gym(["2026-02"]), "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 100]]);
  });

  it("marcarlo pagado en la cuenta secundaria ya no cancela el reembolso (B2)", () => {
    const data = gym(["2026-04"]);
    expect([...legacy(data, "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([]);
    expect([...fixed(data, "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 50]]);
  });

  it("los reembolsos descuentan del acumulado, en cualquier mes", () => {
    const data = gym(["2026-02", "2026-03"], [[3, 80]]);
    expect([...fixed(data, "2026-04").ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 70]]);
  });

  it("en meses futuros se asume un reembolso por mes", () => {
    expect([...fixed(gym(["2026-02", "2026-03"]), "2026-04").ownExpensesPending("2026-06", MAIN)]).toEqual([["sec", 50]]);
  });

  it("A1: el proyectado mostrado es exactamente lo que se arrastra al mes siguiente", () => {
    const core = fixed(gym(["2026-02", "2026-03"]), "2026-04");
    for (const m of ["2026-04", "2026-05", "2026-08"]) {
      expect(core.monthSummary(m).resultado_proyectado).toBe(core.remainingFromPreviousMonth(m.replace(/..$/, (x) => String(Number(x) + 1).padStart(2, "0")), MAIN));
    }
    const s = core.monthSummary("2026-04");
    expect(s.reembolsos_propios_pendientes).toBe(150);
    const old = legacy(gym(["2026-02", "2026-03"]), "2026-04").monthSummary("2026-04");
    expect(old.resultado_proyectado - s.resultado_proyectado).toBe(150);
  });
});

describe("D3 · histórico y saldo proyectado", () => {
  const w = () => {
    const x = world();
    x.fixed_expenses = [{ id: "gym", account_id: "sec", monto: 50, es_propio: true, fecha_inicio: d(2026, 2, 1), fecha_fin: null }];
    x.fixed_expense_instances = ["2026-02", "2026-03"].map((m) => ({ fixed_expense_id: "gym", mes: m, estado: "pagado", monto: null }));
    return x;
  };

  it("antes de ownExpensesFrom los reembolsos se hicieron fuera de la app: no se deben", () => {
    const e = toEngine(w());
    e.settings = { ownExpensesFrom: "2026-03" };
    expect([...new FinanceCore(e, "2026-04", "2026-02", EUROS).ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 100]]);
    e.settings = { ownExpensesFrom: "2026-04" };
    expect([...new FinanceCore(e, "2026-04", "2026-02", EUROS).ownExpensesPending("2026-04", MAIN)]).toEqual([["sec", 50]]);
  });

  it("el saldo proyectado cuenta el reembolso: −pendiente en la principal, + en la cuenta del gasto", () => {
    const now = fixed(w(), "2026-04");
    const old = new FinanceCore(toEngine(w()), "2026-04", "2026-02", { ...EUROS, fixD3: false });
    // mes actual: todo lo pendiente (50 + 50 + 50)
    expect(now.projectedBalance(MAIN, "2026-04").resultado - old.projectedBalance(MAIN, "2026-04").resultado).toBe(-150);
    expect(now.projectedBalance("sec", "2026-04").resultado - old.projectedBalance("sec", "2026-04").resultado).toBe(150);
    // la cuenta secundaria ya no baja cada mes: el gasto propio y su reembolso se compensan
    expect(now.projectedBalance("sec", "2026-06").resultado).toBe(now.projectedBalance("sec", "2026-05").resultado);
  });
});

describe("B3 · budgets con cambio de importe a partir de un mes", () => {
  it("cada mes usa el importe vigente", () => {
    const data = world();
    data.budgets = [{ id: "b", categoria_id: "food", account_id: MAIN, monto: 300, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    const engine = toEngine(data);
    engine.budgets[0].revisions = [{ from: "2026-05", amount: 400 }];
    const core = new FinanceCore(engine, "2026-04", "2026-02", EUROS);
    expect(core.monthProjectedResult(MAIN, "2026-04").budget_details[0].presupuesto).toBe(300);
    expect(core.monthProjectedResult(MAIN, "2026-05").budget_details[0].presupuesto).toBe(400);
    expect(core.monthSummary("2026-06").presupuestos).toBe(400);
  });
});

describe("D5 · mes actual por zona horaria", () => {
  it("a las 00:30 del 1 de noviembre en Madrid ya es noviembre (en UTC aún es octubre)", () => {
    const t = new Date("2026-10-31T23:30:00Z");
    expect(currentMonthInTimeZone("Europe/Madrid", t)).toBe("2026-11");
    expect(currentMonthInTimeZone("UTC", t)).toBe("2026-10");
  });
});

describe("céntimos enteros", () => {
  it("convierte euros a céntimos sin errores binarios", () => {
    const data = world();
    data.expenses = [{ account_id: MAIN, categoria_id: "", monto: 12.34, fecha: d(2026, 3, 1) }, { account_id: MAIN, categoria_id: "", monto: 0.1 + 0.2, fecha: d(2026, 3, 2) }];
    expect(toCents(toEngine(data)).expenses.map((e) => e.amount)).toEqual([1234, 30]);
  });

  it("cada deducción se redondea al céntimo, mitades hacia arriba", () => {
    const data = world();
    data.salaries[0].salario_bruto = 2000.1;
    data.salaries[0].deductions = [{ name: "SS", percentage: 0.0635, applies_to_extras: true }];
    expect(legacy(data, "2026-03").salaryNet("s1", "2026-03")).toBeCloseTo(2000.1 - 127.00635, 9);
    expect(cents(data, "2026-03").salaryBreakdown("s1", "2026-03").deducciones).toBe(12701);
    expect(cents(data, "2026-03").salaryNet("s1", "2026-03")).toBe(187309);
    expect(roundHalfUp(1234.5)).toBe(1235);
    expect(roundHalfUp(-1234.5)).toBe(-1235);
  });

  it("los atrasos sin subida pendiente son exactamente 0 (sin restos de coma flotante)", () => {
    const data = world();
    data.salaries[0].salario_bruto = 3100.55;
    data.salaries[0].revisiones = [{ desde: "2026-04", salario_bruto: 3250.8 }];
    const c = cents(data, "2026-03");
    for (const m of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      expect(c.salaryBreakdown("s1", m).atrasos).toBe(0);
    }
  });

  it("el reparto del déficit son céntimos enteros y suma exactamente lo absorbido", () => {
    const data = world();
    data.salaries[0].salario_bruto = 100;
    data.budgets = ["a", "b", "c"].map((c, i) => ({ id: c, categoria_id: c, account_id: MAIN, monto: [33.33, 33.33, 33.34][i], fecha_inicio: d(2026, 1, 1), fecha_fin: null }));
    data.expenses = [{ account_id: MAIN, categoria_id: "x", monto: 150, fecha: d(2026, 3, 1) }];
    const pr = cents(data, "2026-03").monthProjectedResult(MAIN, "2026-03");
    const shares = pr.budget_details.map((b) => b.absorbed!);
    expect(shares.every(Number.isInteger)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(pr.resultado - pr.resultado_pre_absorcion);
  });
});

// ------------------------------------------------------------------ invariantes del motor corregido
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addMonths, engineMetrics, fromDataset, monthRange } from "../src";

describe("motor corregido sobre los 12 ficheros sintéticos", () => {
  const DIR = join(__dirname, "..", "..", "fixtures", "reference");
  for (const f of readdirSync(DIR).filter((x) => /^synthetic-\d+\.json$/.test(x)).sort()) {
    const ref = JSON.parse(readFileSync(join(DIR, f), "utf-8"));
    for (const c of ref.cases) {
      it(`${f} · ${c.currentMonth}: céntimos enteros, A1 y B1`, () => {
        const core = new FinanceCore(fromDataset(ref.dataset, { cents: true }), c.currentMonth, c.startMonth, CURRENT_OPTIONS);
        const main = ref.dataset.profile.settings.mainAccountId;
        for (const m of monthRange(c.months[0], c.months[1])) {
          const s = core.monthSummary(m);
          for (const v of [s.resultado_real, s.resultado_proyectado, s.remaining_from_previous_month]) expect(Number.isInteger(v)).toBe(true);
          for (const a of Object.keys(ref.dataset.docs.accounts)) {
            expect(Number.isInteger(core.realBalance(a, m))).toBe(true);
            expect(Number.isInteger(core.projectedBalance(a, m).resultado)).toBe(true);
          }
          // A1: en meses abiertos, lo que se muestra es lo que se arrastra.
          if (m >= c.currentMonth && m < c.months[1]) {
            expect(core.remainingFromPreviousMonth(addMonths(m, 1), main)).toBe(s.resultado_proyectado);
          }
          // B1: el saldo proyectado futuro se construye mes a mes desde el anterior,
          // con el reembolso previsto de los gastos propios de ese mes (sale de la principal).
          if (m > c.currentMonth) {
            const prev = core.projectedBalance(main, addMonths(m, -1)).resultado;
            const refunds = [...core.ownExpensesPending(m, main).values()].reduce((x, y) => x + y, 0);
            expect(core.projectedBalance(main, m).resultado).toBe(core.monthProjectedResult(main, m, prev).resultado - refunds);
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------- decisiones del 18-oct-2026

describe("A · deducciones a partir de un mes", () => {
  it("cada mes usa las deducciones vigentes; los anteriores no cambian", () => {
    const data = world();
    data.salaries[0].deductions = [{ name: "IRPF", percentage: 0.1, applies_to_extras: true }];
    const engine = toEngine(data);
    const before = new FinanceCore(toEngine(data), "2026-06", "2026-02", EUROS);
    engine.salaries[0].deductionRevisions = [{ from: "2026-05", deductions: [{ name: "IRPF", rate: 0.15, appliesToExtras: true }] }];
    const after = new FinanceCore(engine, "2026-06", "2026-02", EUROS);
    expect(after.salaryNet("s1", "2026-04")).toBe(before.salaryNet("s1", "2026-04"));
    expect(before.salaryNet("s1", "2026-05")).toBeCloseTo(1800, 9);
    expect(after.salaryNet("s1", "2026-05")).toBeCloseTo(1700, 9);
    expect(after.salaryNet("s1", "2026-09")).toBeCloseTo(1700, 9);
    // Meses cerrados: el arrastre hasta abril es idéntico.
    expect(after.remainingFromPreviousMonth("2026-05", MAIN)).toBe(before.remainingFromPreviousMonth("2026-05", MAIN));
  });
});

describe("B · «gasto propio» a partir de un mes", () => {
  it("solo los meses desde la revisión generan reembolso", () => {
    const data = world();
    data.fixed_expenses = [{ id: "f", nombre: "Seguro", monto: 50, fecha_inicio: d(2026, 2, 1), fecha_fin: null, account_id: "sec", es_propio: false }];
    const engine = toEngine(data);
    engine.fixedExpenses[0].revisions = [{ from: "2026-05", isOwn: true }];
    const core = new FinanceCore(engine, "2026-04", "2026-02", EUROS);
    expect(core.fixedExpensesForMonth("2026-04")[0].isOwn).toBe(false);
    expect(core.fixedExpensesForMonth("2026-05")[0].isOwn).toBe(true);
    expect([...core.ownExpensesPending("2026-04", MAIN)]).toEqual([]);
    expect([...core.ownExpensesPending("2026-05", MAIN)]).toEqual([["sec", 50]]);
    // Y al revés: dejar de serlo desde un mes.
    engine.fixedExpenses[0].isOwn = true;
    engine.fixedExpenses[0].revisions = [{ from: "2026-06", isOwn: false }];
    const core2 = new FinanceCore(engine, "2026-04", "2026-02", EUROS);
    expect(core2.fixedExpensesForMonth("2026-05")[0].isOwn).toBe(true);
    expect(core2.fixedExpensesForMonth("2026-06")[0].isOwn).toBe(false);
  });
});

describe("C · pagos de tarjeta por tarjeta", () => {
  function twoCards() {
    const data = world();
    data.expenses = [
      { id: "e1", fecha: d(2026, 3, 5), monto: 100, categoria_id: "x", account_id: MAIN, metodo_pago: "credito", mes_cargo: "2026-04" },
      { id: "e2", fecha: d(2026, 3, 6), monto: 40, categoria_id: "x", account_id: MAIN, metodo_pago: "credito", mes_cargo: "2026-04" },
    ];
    data.credit_settlements = [{ id: "st", account_id: MAIN, mes_cargo: "2026-04", fecha: d(2026, 4, 2), monto: 100 }];
    const engine = toEngine(data);
    engine.expenses[0].cardId = "visa";
    engine.expenses[1].cardId = "amex";
    engine.settlements[0].cardId = "visa";
    return engine;
  }
  it("saldar una tarjeta no salda la otra de la misma cuenta", () => {
    const core = new FinanceCore(twoCards(), "2026-04", "2026-02", EUROS);
    const groups = core.creditGroups();
    expect(groups.map((g) => [g.card_id, g.total, !!g.settlement])).toEqual([["amex", 40, false], ["visa", 100, true]]);
    expect(core.creditOutstanding(MAIN, "2026-04")).toBe(40);
  });
  it("la regla vieja (por cuenta) daba las dos por saldadas", () => {
    const core = new FinanceCore(twoCards(), "2026-04", "2026-02", { ...EUROS, perCardSettlement: false });
    expect(core.creditGroups()).toHaveLength(1);
    expect(core.creditOutstanding(MAIN, "2026-04")).toBe(0);
  });
});

describe("C no cambia nada con una tarjeta por cuenta (tus datos)", () => {
  const DIR2 = join(__dirname, "..", "..", "fixtures", "reference");
  for (const f of readdirSync(DIR2).filter((x) => /^synthetic-\d+\.json$/.test(x)).sort()) {
    it(f, () => {
      const ref = JSON.parse(readFileSync(join(DIR2, f), "utf-8"));
      for (const c of ref.cases) {
        const data = fromDataset(ref.dataset, { cents: true });
        const range = monthRange(c.months[0], c.months[1]);
        const a = engineMetrics(data, c.currentMonth, c.startMonth, range, CURRENT_OPTIONS);
        const b = engineMetrics(data, c.currentMonth, c.startMonth, range, { ...CURRENT_OPTIONS, perCardSettlement: false });
        expect(a).toEqual(b);
      }
    });
  }
});


it("las deducciones una a una suman las del desglose", () => {
  const data = world();
  data.salaries[0].deductions = [{ name: "SS", percentage: 0.0635, applies_to_extras: true }, { name: "IRPF", percentage: 0.1308, applies_to_extras: true }];
  const core = cents(data, "2026-04");
  const lines = core.salaryDeductionLines("s1", "2026-04");
  expect(lines.map((l) => l.name)).toEqual(["SS", "IRPF"]);
  expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(core.salaryBreakdown("s1", "2026-04").deducciones);
  expect(lines[0].amount).toBe(12700); // 2.000 € × 6,35 %
});

describe("Gasto fijo que cuenta en un budget", () => {
  const ds = (counts: boolean, paid: number | null = null) => ({
    profile: { settings: { mainAccountId: "m", startMonth: "2026-02" } },
    docs: {
      accounts: { m: { name: "M", initialBalance: 0 }, o: { name: "O", initialBalance: 0 } },
      categories: { casa: { name: "Casa" } },
      salaries: { s: { accountId: "m", grossMonthly: 3000, deductions: [], start: "2026-02-01", end: null, revisions: [], overtimes: [] } },
      budgets: { b: { accountId: "m", categoryId: "casa", amount: 1000, start: "2026-02-01", end: null } },
      fixedExpenses: {
        rent: { name: "Alquiler", accountId: "m", amount: 700, start: "2026-02-01", end: null, isOwnExpense: false, revisions: [],
          categoryId: "casa", countsInBudget: counts, payments: paid === null ? {} : { "2026-04": { status: "paid", amount: paid } } },
      },
      movements: { e: { type: "expense", date: "2026-04-03", amount: 100, accountId: "m", categoryId: "casa" } },
    },
  });
  const core = (counts: boolean, paid: number | null = null) =>
    new FinanceCore(fromDataset(ds(counts, paid) as never, { cents: true }), "2026-04", "2026-02", CURRENT_OPTIONS);

  it("sin marcar: fijo y budget se reservan por separado (como siempre)", () => {
    const p = core(false).monthProjectedResult("m", "2026-04");
    expect(p.resultado).toBe(300000 - 70000 - 100000);
    expect(p.budget_details[0].fixed_in_budget).toBeUndefined();
  });
  it("marcado: el fijo consume el budget; se reserva el mayor de budget y gasto real", () => {
    const p = core(true).monthProjectedResult("m", "2026-04");
    expect(p.resultado).toBe(300000 - 100000);                 // 700 fijo + 300 que quedan de budget
    expect(p.budget_details[0]).toMatchObject({ fixed_in_budget: 70000, available: 100000 - 70000 - 10000 });
  });
  it("marcado y pagado con otro importe: cuenta lo pagado", () => {
    const p = core(true, 750).monthProjectedResult("m", "2026-04");
    expect(p.budget_details[0].fixed_in_budget).toBe(75000);
    expect(p.resultado).toBe(300000 - 100000);
  });
  it("si fijo + gastos superan el budget, se reserva lo real", () => {
    const d = ds(true); (d.docs.movements as Record<string, unknown>).e2 = { type: "expense", date: "2026-04-05", amount: 400, accountId: "m", categoryId: "casa" };
    const c = new FinanceCore(fromDataset(d as never, { cents: true }), "2026-04", "2026-02", CURRENT_OPTIONS);
    expect(c.monthProjectedResult("m", "2026-04").resultado).toBe(300000 - 70000 - 50000);
  });
  it("saldo previsto del mes en curso: mismo criterio", () => {
    const a = core(false).projectedBalance("m", "2026-04").resultado;
    const b = core(true).projectedBalance("m", "2026-04").resultado;
    expect(a - b).toBe(-70000);
  });
  it("no cambia el saldo real", () => {
    expect(core(true, 750).realBalance("m", "2026-04")).toBe(core(false, 750).realBalance("m", "2026-04"));
  });
  it("de otra cuenta: no cuenta en el budget", () => {
    const d = ds(true); (d.docs.fixedExpenses.rent as Record<string, unknown>).accountId = "o";
    const c = new FinanceCore(fromDataset(d as never, { cents: true }), "2026-04", "2026-02", CURRENT_OPTIONS);
    expect(c.fixedInBudget("2026-04", "m").size).toBe(0);
  });
});

it("gasto fijo en el budget: con dos budgets de la misma categoría cuenta una sola vez", () => {
  const mk = (counts: boolean) => new FinanceCore(fromDataset({
    profile: { settings: { mainAccountId: "m", startMonth: "2026-02" } },
    docs: {
      accounts: { m: { name: "M", initialBalance: 0 } }, categories: { casa: { name: "Casa" } },
      budgets: { b1: { accountId: "m", categoryId: "casa", amount: 1000, start: "2026-02-01", end: null },
                 b2: { accountId: "m", categoryId: "casa", amount: 200, start: "2026-02-01", end: null } },
      fixedExpenses: { r: { name: "R", accountId: "m", amount: 700, start: "2026-02-01", end: null, isOwnExpense: false, revisions: [], payments: {}, categoryId: "casa", countsInBudget: counts } },
    },
  } as never, { cents: true }), "2026-04", "2026-02", CURRENT_OPTIONS);
  // sin marcar: 700 + 1000 + 200; marcado: el fijo se come 700 del primero → 700 + 300 + 200
  expect(mk(false).monthProjectedResult("m", "2026-04").resultado_pre_absorcion - mk(true).monthProjectedResult("m", "2026-04").resultado_pre_absorcion).toBe(-70000);
});

describe("D · un ingreso con la categoría de un budget es una devolución", () => {
  const mk = (incomes: Record<string, unknown>, expenses: Record<string, unknown>, opts = CURRENT_OPTIONS) => new FinanceCore(fromDataset({
    profile: { settings: { mainAccountId: "m", startMonth: "2026-02" } },
    docs: {
      accounts: { m: { name: "M", initialBalance: 0 }, o: { name: "O", initialBalance: 0 } }, categories: { g: { name: "Gasolina" }, x: { name: "Extra" } },
      salaries: { s: { accountId: "m", grossMonthly: 3000, deductions: [], start: "2026-02-01", end: null, revisions: [], overtimes: [] } },
      budgets: { b: { accountId: "m", categoryId: "g", amount: 250, start: "2026-02-01", end: null } },
      movements: { ...incomes, ...expenses },
    },
  } as never, { cents: true }), "2026-04", "2026-02", opts);
  const inc = (amount: number, categoryId = "g", accountId = "m") => ({ i: { type: "income", date: "2026-04-10", amount, accountId, categoryId } });
  const exp = (amount: number) => ({ e: { type: "expense", date: "2026-04-03", amount, accountId: "m", categoryId: "g" } });

  it("te pasas, te devuelven parte: el budget baja y el ingreso no cuenta dos veces", () => {
    const c = mk(inc(100), exp(300));
    expect(c.monthProjectedResult("m", "2026-04").resultado).toBe(300000 - 25000);   // neto 200 < 250: se reservan 250
    expect(c.monthProjectedResult("m", "2026-04").budget_details[0]).toMatchObject({ income_offset: 10000, available: 5000 });
    // Antes: +100 − 300 (el budget pasado reservaba lo gastado)
    expect(mk(inc(100), exp(300), { ...CURRENT_OPTIONS, incomeOffsetsBudget: false }).monthProjectedResult("m", "2026-04").resultado).toBe(300000 + 10000 - 30000);
  });
  it("devolución antes de gastar: el previsto no salta cuando luego gastas", () => {
    const before = mk(inc(100), {}).monthProjectedResult("m", "2026-04").resultado;
    const after = mk(inc(100), exp(250)).monthProjectedResult("m", "2026-04").resultado;
    expect(before).toBe(300000 - 25000);
    expect(after).toBe(before);
  });
  it("saldo previsto del mes en curso: mismo criterio; el saldo real no cambia", () => {
    const on = mk(inc(100), exp(300)), off = mk(inc(100), exp(300), { ...CURRENT_OPTIONS, incomeOffsetsBudget: false });
    expect(on.realBalance("m", "2026-04")).toBe(off.realBalance("m", "2026-04"));
    expect(on.projectedBalance("m", "2026-04").resultado).toBe(on.realBalance("m", "2026-04") - 5000);  // quedan 50 de budget
    expect(on.monthRealResult("m", "2026-04")).toBe(off.monthRealResult("m", "2026-04"));
  });
  it("sin budget de esa categoría, o en otra cuenta: es un ingreso normal", () => {
    expect(mk(inc(100, "x"), {}).budgetIncomeOffsets("2026-04", "m").size).toBe(0);
    expect(mk(inc(100, "g", "o"), {}).budgetIncomeOffsets("2026-04", "m").size).toBe(0);
  });
});
