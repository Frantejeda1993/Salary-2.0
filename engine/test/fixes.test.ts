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
import { addMonths, fromDataset, monthRange } from "../src";

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
