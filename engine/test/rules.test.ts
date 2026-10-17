/**
 * Reglas de negocio del motor, portadas de los tests del repo viejo
 * (tests/test_finance_rules.py, test_credit_card.py, test_salary_revisions.py,
 * test_fixed_expense_revisions.py, test_dashboard_helpers.py) con los mismos datos
 * y las mismas expectativas. Si un cambio de la Fase 4b rompe uno, o el cambio está
 * mal o la regla cambia a propósito: entonces se actualiza el test en el mismo commit.
 *
 * No se portan: test_legacy_salary_without_deductions_key_is_migrated y
 * test_explicit_empty_deductions_… (la normalización de deducciones legacy ya la hace
 * la migración, probada en tools/migrate), test_min_managed_month_from_secrets (Streamlit)
 * y test_pages_smoke (UI de Streamlit).
 */
import { describe, expect, it } from "vitest";
import { FinanceCore, fixedAmountForMonth } from "../src";
import { d, emptyData, toEngine, type Legacy } from "./legacy";

const MAIN = "main";
const core = (L: Legacy, current: string, min = "2026-02") => new FinanceCore(toEngine(L), current, min);
const approx = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

// ============================================================================ test_finance_rules.py

function base(salary = 2000, deductions: any[] | null = null, start: [number, number] = [2026, 1]): Legacy {
  const data = emptyData();
  data.accounts = [
    { id: MAIN, nombre: "Main", is_main: true, saldo_inicial: 1000 },
    { id: "sec", nombre: "Sec", is_main: false, saldo_inicial: 0 },
  ];
  data.categories = [{ id: "food", tipo: "normal" }, { id: "fun", tipo: "normal" }, { id: "gift", tipo: "extra" }];
  data.salaries = [{ id: "s1", account_id: MAIN, salario_bruto: salary, fecha_inicio: d(start[0], start[1], 1), fecha_fin: null, deductions: deductions ?? [] }];
  return data;
}
const expense = (data: Legacy, cat: string, amount: number, month: number, account = MAIN, day = 10) =>
  data.expenses.push({ id: `e${data.expenses.length}`, account_id: account, categoria_id: cat, monto: amount, fecha: d(2026, month, day) });
const budget = (data: Legacy, cat: string, amount: number, account = MAIN) =>
  data.budgets.push({ id: `b${cat}`, categoria_id: cat, account_id: account, monto: amount, fecha_inicio: d(2026, 1, 1), fecha_fin: null });

describe("salario", () => {
  it("aplica deducciones y el flag de horas extra", () => {
    const data = base(2000, [
      { name: "SS", percentage: 0.05, applies_to_extras: true },
      { name: "IRPF", percentage: 0.10, applies_to_extras: false },
    ]);
    data.overtimes = [{ salary_id: "s1", mes_aplicacion: "2026-03", monto_bruto: 200 }];
    const c = core(data, "2026-03");
    approx(c.salaryNet("s1", "2026-03"), 1890);
    approx(c.salaryNet("s1", "2026-04"), 2000 - 100 - 200);
  });
});

describe("resultado real", () => {
  it("es de caja: el fijo cuenta al marcarlo pagado y gana el importe pagado", () => {
    const data = base(2000);
    expense(data, "food", 150, 3);
    data.fixed_expenses = [{ id: "rent", account_id: MAIN, monto: 700, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    expect(core(data, "2026-03").monthRealResult(MAIN, "2026-03")).toBe(2000 - 150);
    data.fixed_expense_instances = [{ fixed_expense_id: "rent", mes: "2026-03", estado: "pagado", monto: 690 }];
    expect(core(data, "2026-03").monthRealResult(MAIN, "2026-03")).toBe(2000 - 150 - 690);
  });
});

describe("resultado proyectado", () => {
  it("un budget cobra al menos su importe, y el exceso si se supera", () => {
    const data = base(2000);
    budget(data, "food", 300);
    expense(data, "food", 120, 3);
    expect(core(data, "2026-03").monthProjectedResult(MAIN, "2026-03").resultado).toBe(2000 - 300);
    expense(data, "food", 250, 3);
    expect(core(data, "2026-03").monthProjectedResult(MAIN, "2026-03").resultado).toBe(2000 - 370);
  });

  it("los gastos sin budget se cobran enteros", () => {
    const data = base(2000);
    expense(data, "fun", 80, 3);
    expect(core(data, "2026-03").monthProjectedResult(MAIN, "2026-03").resultado).toBe(1920);
  });

  it("un ingreso con categoría no se cuenta dos veces", () => {
    const data = base(2000);
    budget(data, "food", 300);
    expense(data, "food", 100, 3);
    data.incomes = [{ id: "i1", account_id: MAIN, categoria_id: "food", monto: 40, fecha: d(2026, 3, 12) }];
    expect(core(data, "2026-03").monthProjectedResult(MAIN, "2026-03").resultado).toBe(2000 + 40 - 300);
  });

  it("el déficit lo absorben los budgets con margen, en proporción, y se conserva el valor previo", () => {
    const data = base(500);
    budget(data, "food", 300);
    budget(data, "fun", 100);
    expense(data, "food", 100, 3);
    expense(data, "gift", 350, 3);
    const proj = core(data, "2026-03").monthProjectedResult(MAIN, "2026-03");
    approx(proj.resultado_pre_absorcion, -250);
    approx(proj.resultado, 0);
    for (const bd of proj.budget_details) {
      approx(bd.presupuesto - Math.max(bd.real_spent, 0) - (bd.absorbed ?? 0) - bd.available, 0);
    }
    const food = proj.budget_details.find((b) => b.categoria_id === "food")!;
    approx(food.absorbed!, (250 * 200) / 300);
  });

  it("la absorción tiene como tope el margen disponible", () => {
    const data = base(100);
    budget(data, "food", 50);
    expense(data, "gift", 300, 3);
    const proj = core(data, "2026-03").monthProjectedResult(MAIN, "2026-03");
    approx(proj.resultado_pre_absorcion, 100 - 50 - 300);
    approx(proj.resultado, -200);
  });
});

describe("arrastre", () => {
  it("no hay arrastre en o antes de min_managed_month", () => {
    expect(core(base(), "2026-05").remainingFromPreviousMonth("2026-02", MAIN)).toBe(0);
  });

  it("los meses cerrados arrastran su resultado real acumulado", () => {
    const data = base(2000, null, [2026, 2]);
    expense(data, "fun", 500, 2);
    expense(data, "fun", 300, 3);
    const c = core(data, "2026-04");
    expect(c.remainingFromPreviousMonth("2026-03", MAIN)).toBe(1500);
    expect(c.remainingFromPreviousMonth("2026-04", MAIN)).toBe(1500 + 1700);
  });

  it("los meses futuros encadenan el proyectado", () => {
    const data = base(2000, null, [2026, 2]);
    budget(data, "food", 400);
    const c = core(data, "2026-04");
    const april = c.remainingFromPreviousMonth("2026-04", MAIN);
    approx(c.remainingFromPreviousMonth("2026-05", MAIN), april + 1600);
    approx(c.remainingFromPreviousMonth("2026-07", MAIN), april + 3 * 1600);
  });

  it("la cadena futura resta los gastos propios pendientes", () => {
    const data = base(2000, null, [2026, 2]);
    data.fixed_expenses = [{ id: "gym", account_id: "sec", monto: 50, es_propio: true, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    const c = core(data, "2026-04");
    approx(c.remainingFromPreviousMonth("2026-05", MAIN), c.remainingFromPreviousMonth("2026-04", MAIN) + 2000 - 50);
  });

  it("el reembolso automático cancela el gasto propio de ese mes", () => {
    const data = base(2000);
    data.fixed_expenses = [{ id: "gym", account_id: "sec", monto: 50, es_propio: true, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    data.transfers = [{ id: "t1", cuenta_origen: MAIN, cuenta_destino: "sec", monto: 50, fecha: d(2026, 4, 2), descripcion: "Transferencia automatica gastos" }];
    const c = core(data, "2026-04");
    expect([...c.propioExpensesByAccount("2026-04", MAIN)]).toEqual([]);
    expect([...c.propioExpensesByAccount("2026-05", MAIN)]).toEqual([["sec", 50]]);
  });
});

describe("saldos", () => {
  it("el saldo real acumula desde el saldo inicial", () => {
    const data = base(2000);
    expense(data, "fun", 100, 1);
    expense(data, "fun", 100, 2);
    const c = core(data, "2026-02");
    expect(c.realBalance(MAIN, "2026-01")).toBe(1000 + 2000 - 100);
    expect(c.realBalance(MAIN, "2026-02")).toBe(1000 + 4000 - 200);
  });

  it("saldo proyectado = proyectado del mes sin arrastre + saldo real del mes anterior", () => {
    const data = base(2000);
    budget(data, "food", 300);
    expense(data, "food", 120, 3);
    expense(data, "fun", 60, 3);
    data.fixed_expenses = [{ id: "rent", account_id: MAIN, monto: 700, fecha_inicio: d(2026, 1, 1), fecha_fin: null }];
    data.fixed_expense_instances = ["2026-01", "2026-02"].map((m) => ({ fixed_expense_id: "rent", mes: m, estado: "pagado", monto: null }));
    const c = core(data, "2026-03");
    approx(c.projectedBalance(MAIN, "2026-03").resultado, c.monthProjectedResult(MAIN, "2026-03").resultado + c.realBalance(MAIN, "2026-02"));
  });
});

// ============================================================================ test_credit_card.py

function scenario(opts: { reservar_en?: string; settled_on?: [number, number, number]; amount?: number; budget?: number; mes_cargo?: string | null } = {}) {
  const { reservar_en = "compra", settled_on, amount = 300, budget: bud, mes_cargo = "2026-04" } = opts;
  const data = emptyData();
  data.accounts = [{ id: MAIN, is_main: true, saldo_inicial: 0 }];
  data.categories = [{ id: "food", tipo: "normal" }];
  data.salaries = [{ id: "s1", account_id: MAIN, salario_bruto: 2000, fecha_inicio: d(2026, 3, 1), fecha_fin: null, deductions: [] }];
  data.expenses = [{ id: "cc1", account_id: MAIN, categoria_id: "food", monto: amount, fecha: d(2026, 3, 20), metodo_pago: "credito", mes_cargo, reservar_en }];
  if (bud) data.budgets = [{ id: "b", categoria_id: "food", account_id: MAIN, monto: bud, fecha_inicio: d(2026, 3, 1), fecha_fin: null }];
  if (settled_on) data.credit_settlements = [{ id: "s", account_id: MAIN, mes_cargo, fecha: d(...settled_on), monto: amount }];
  return data;
}
const projected = (data: Legacy, current: string, month: string) => {
  const c = core(data, current);
  return c.monthProjectedResult(MAIN, month, c.remainingFromPreviousMonth(month, MAIN)).resultado;
};
const realShown = (data: Legacy, current: string, month: string) => {
  const c = core(data, current);
  return c.monthRealResult(MAIN, month) + c.remainingFromPreviousMonth(month, MAIN);
};

describe("tarjeta de crédito", () => {
  it("la compra resta del proyectado, no del real, en el mes de compra", () => {
    const data = scenario();
    expect(projected(data, "2026-03", "2026-03")).toBe(1700);
    expect(realShown(data, "2026-03", "2026-03")).toBe(2000);
  });

  for (const settled_on of [undefined, [2026, 4, 5], [2026, 5, 3]] as const) {
    for (const month of ["2026-04", "2026-05", "2026-06"]) {
      it(`el proyectado de ${month} no depende del mes actual (saldada ${settled_on?.join("-") ?? "no"})`, () => {
        const data = scenario({ settled_on: settled_on as any });
        const expected = 1700 + 2000 * (Number(month.slice(-2)) - 3);
        for (const current of ["2026-03", "2026-04", "2026-05", "2026-06"]) {
          if (current > month) continue;
          approx(projected(data, current, month), expected);
        }
      });
    }
  }

  it("el real solo se mueve al saldar", () => {
    expect(realShown(scenario(), "2026-04", "2026-04")).toBe(4000);
    const settled = scenario({ settled_on: [2026, 4, 5] });
    expect(realShown(settled, "2026-04", "2026-04")).toBe(3700);
    expect(projected(settled, "2026-04", "2026-04")).toBe(3700);
  });

  it("reservada en el mes de cargo: el mes de compra no se toca", () => {
    const data = scenario({ reservar_en: "cargo" });
    expect(projected(data, "2026-03", "2026-03")).toBe(2000);
    expect(projected(data, "2026-03", "2026-04")).toBe(3700);
    expect(projected(data, "2026-04", "2026-04")).toBe(3700);
  });

  it("reservada en el mes de cargo: cuenta en el budget de ese mes", () => {
    const c = core(scenario({ reservar_en: "cargo", amount: 100, budget: 250 }), "2026-03");
    expect(c.rawCategoryExpenses("2026-03", MAIN).get("food") ?? 0).toBe(0);
    expect(c.rawCategoryExpenses("2026-04", MAIN).get("food")).toBe(100);
  });

  it("reservada en el mes de compra: consume el budget de ese mes", () => {
    const c = core(scenario({ amount: 100, budget: 250 }), "2026-03");
    expect(c.rawCategoryExpenses("2026-03", MAIN).get("food")).toBe(100);
    expect(c.monthProjectedResult(MAIN, "2026-03").resultado).toBe(2000 - 250);
  });

  it("saldos y deuda de la tarjeta", () => {
    const c = core(scenario(), "2026-04");
    expect(c.realBalance(MAIN, "2026-03")).toBe(2000);
    expect(c.projectedBalance(MAIN, "2026-03").resultado).toBe(1700);
    expect(c.creditOutstanding(MAIN, "2026-04", false)).toBe(300);
    const s = core(scenario({ settled_on: [2026, 4, 5] }), "2026-04");
    expect(s.realBalance(MAIN, "2026-04")).toBe(3700);
    expect(s.creditOutstanding(MAIN, "2026-04", false)).toBe(0);
    expect(s.projectedBalance(MAIN, "2026-04").resultado).toBe(3700);
  });

  it("el mes de cargo por defecto es el siguiente y se agrupa por cuenta y mes", () => {
    const data = scenario({ mes_cargo: null });
    data.expenses.push({ id: "cc2", account_id: MAIN, categoria_id: "food", monto: 50, fecha: d(2026, 3, 25), metodo_pago: "credito" });
    const groups = core(data, "2026-03").creditGroups();
    expect(groups.length).toBe(1);
    expect([groups[0].mes_cargo, groups[0].total]).toEqual(["2026-04", 350]);
  });

  it("compra tras el corte: se cobra dos meses después", () => {
    const data = scenario({ mes_cargo: "2026-05" });
    approx(projected(data, "2026-05", "2026-05"), 1700 + 4000);
    expect(realShown(data, "2026-04", "2026-04")).toBe(4000);
  });
});

// ============================================================================ test_salary_revisions.py

function salData(revisiones: any[] = [], deductions: any[] = []) {
  const data = emptyData();
  data.accounts = [{ id: MAIN, is_main: true, saldo_inicial: 0 }];
  data.salaries = [{ id: "s1", account_id: MAIN, salario_bruto: 2000, fecha_inicio: d(2026, 1, 1), fecha_fin: null, deductions, revisiones }];
  return data;
}
const gross = (c: FinanceCore, months: string[]) => months.map((m) => c.salaryBreakdown("s1", m).base + c.salaryBreakdown("s1", m).atrasos);

describe("subidas salariales", () => {
  it("subida normal desde un mes", () => {
    expect(gross(core(salData([{ desde: "2026-06", salario_bruto: 2200 }]), "2026-03"), ["2026-05", "2026-06", "2026-07"])).toEqual([2000, 2200, 2200]);
  });

  it("subida retroactiva: los atrasos se cobran en el mes de cobro", () => {
    const c = core(salData([{ desde: "2026-04", salario_bruto: 2200, cobro_desde: "2026-06" }]), "2026-03");
    expect(gross(c, ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"])).toEqual([2000, 2000, 2000, 2600, 2200]);
    const june = c.salaryBreakdown("s1", "2026-06");
    expect([june.base, june.atrasos]).toEqual([2200, 400]);
  });

  it("lo cobrado acaba igualando lo debido", () => {
    const c = core(salData([{ desde: "2026-04", salario_bruto: 2200, cobro_desde: "2026-06" }]), "2026-08");
    const months = Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}`);
    expect(gross(c, months).reduce((a, b) => a + b, 0)).toBe(3 * 2000 + 5 * 2200);
  });

  it("dos subidas, una retroactiva, solapadas", () => {
    const c = core(salData([
      { desde: "2026-03", salario_bruto: 2100, cobro_desde: "2026-05" },
      { desde: "2026-05", salario_bruto: 2300 },
    ]), "2026-01");
    expect(gross(c, ["2026-03", "2026-04", "2026-05", "2026-06"])).toEqual([2000, 2000, 2500, 2300]);
  });

  it("las deducciones se aplican también a los atrasos", () => {
    const c = core(salData([{ desde: "2026-04", salario_bruto: 2200, cobro_desde: "2026-06" }],
      [{ name: "IRPF", percentage: 0.10, applies_to_extras: false }]), "2026-03");
    approx(c.salaryNet("s1", "2026-06"), 2600 * 0.9);
  });

  it("la subida llega al saldo real y al proyectado", () => {
    const c = core(salData([{ desde: "2026-04", salario_bruto: 2200, cobro_desde: "2026-06" }]), "2026-06");
    expect(c.realBalance(MAIN, "2026-06")).toBe(5 * 2000 + 2600);
    expect(c.monthProjectedResult(MAIN, "2026-06").resultado).toBe(2600);
  });

  it("sin revisiones el neto no cambia", () => {
    expect(core(salData(), "2026-03").salaryNet("s1", "2026-03")).toBe(2000);
  });
});

// ============================================================================ test_fixed_expense_revisions.py

function rent(revisiones: any[] = [], paid: string[] = []) {
  const data = emptyData();
  data.accounts = [{ id: MAIN, is_main: true, saldo_inicial: 0 }];
  data.fixed_expenses = [{ id: "rent", account_id: MAIN, monto: 700, fecha_inicio: d(2026, 1, 1), fecha_fin: null, revisiones }];
  data.fixed_expense_instances = paid.map((m) => ({ fixed_expense_id: "rent", mes: m, estado: "pagado", monto: null }));
  return data;
}
const twoAccounts = (revisiones: any[], paid: string[] = []) => {
  const data = rent(revisiones, paid);
  data.accounts.push({ id: "sec", is_main: false, saldo_inicial: 0 });
  return data;
};

describe("gastos fijos con cambios", () => {
  it("el importe sigue las revisiones en orden", () => {
    const fe = toEngine({ ...emptyData(), fixed_expenses: [{ id: "x", monto: 700, fecha_inicio: d(2026, 1, 1),
      revisiones: [{ desde: "2026-09", monto: 760 }, { desde: "2026-04", monto: 730 }] }] }).fixedExpenses[0];
    expect(["2026-03", "2026-04", "2026-08", "2026-09", "2027-01"].map((m) => fixedAmountForMonth(fe, m))).toEqual([700, 730, 730, 760, 760]);
  });

  it("un cambio afecta al futuro, no al pasado", () => {
    const c = core(rent([{ desde: "2026-05", monto: 750 }]), "2026-04");
    expect(c.fixedExpensesForMonth("2026-04")[0].monto).toBe(700);
    expect(c.fixedExpensesForMonth("2026-05")[0].monto).toBe(750);
    expect(c.monthProjectedResult(MAIN, "2026-05").resultado).toBe(-750);
  });

  it("los pagos sin importe usan el importe de ese mes", () => {
    expect(core(rent([{ desde: "2026-03", monto: 750 }], ["2026-01", "2026-02", "2026-03"]), "2026-03").realBalance(MAIN, "2026-03"))
      .toBe(-(700 + 700 + 750));
  });

  it("sin revisiones se comporta igual que antes", () => {
    expect(core(rent(), "2026-03").fixedExpensesForMonth("2026-03")[0].monto).toBe(700);
  });

  it("un cambio de cuenta mueve el gasto solo desde ese mes", () => {
    const c = core(twoAccounts([{ desde: "2026-05", account_id: "sec", bank_id: "b2" }]), "2026-04");
    expect(c.fixedExpensesForMonth("2026-04")[0].account_id).toBe(MAIN);
    expect(c.fixedExpensesForMonth("2026-05")[0].account_id).toBe("sec");
    expect(c.fixedExpensesForMonth("2026-05")[0].monto).toBe(700);
    expect(c.monthProjectedResult(MAIN, "2026-05").resultado).toBe(0);
    expect(c.monthProjectedResult("sec", "2026-05").resultado).toBe(-700);
  });

  it("los pagos ya hechos se quedan en la cuenta de la que salieron", () => {
    const c = core(twoAccounts([{ desde: "2026-03", account_id: "sec" }], ["2026-01", "2026-02", "2026-03", "2026-04"]), "2026-04");
    expect(c.realBalance(MAIN, "2026-04")).toBe(-1400);
    expect(c.realBalance("sec", "2026-04")).toBe(-1400);
  });

  it("revisiones de importe y de cuenta se combinan", () => {
    const jun = core(twoAccounts([{ desde: "2026-03", monto: 750 }, { desde: "2026-06", account_id: "sec" }]), "2026-01").fixedExpensesForMonth("2026-06")[0];
    expect([jun.monto, jun.account_id]).toEqual([750, "sec"]);
  });

  it("mover un gasto propio a la principal deja de pedir reembolso", () => {
    const data = twoAccounts([{ desde: "2026-05", account_id: MAIN }]);
    Object.assign(data.fixed_expenses[0], { account_id: "sec", es_propio: true });
    const c = core(data, "2026-04");
    expect([...c.propioExpensesByAccount("2026-04", MAIN)]).toEqual([["sec", 700]]);
    expect([...c.propioExpensesByAccount("2026-05", MAIN)]).toEqual([]);
  });
});

// ============================================================================ test_dashboard_helpers.py

describe("dashboard", () => {
  it("ritmo de budget", () => {
    expect(FinanceCore.budgetPace(150, 300, 10, 30).status).toBe("por encima del ritmo");
    expect(FinanceCore.budgetPace(90, 300, 10, 30).status).toBe("ok");
    expect(FinanceCore.budgetPace(310, 300, 10, 30).status).toBe("excedido");
    expect(FinanceCore.budgetPace(0, 300, 0, 30).forecast).toBe(0);
  });

  it("pendientes de pagar: recoge cada tipo", () => {
    const data = emptyData();
    data.accounts = [{ id: "main", is_main: true, saldo_inicial: 0 }, { id: "sec", is_main: false, saldo_inicial: 0 }];
    data.fixed_expenses = [
      { id: "rent", nombre: "Alquiler", account_id: "main", monto: 700, fecha_inicio: d(2026, 1, 1), fecha_fin: null },
      { id: "gym", nombre: "Gym", account_id: "sec", monto: 40, es_propio: true, fecha_inicio: d(2026, 1, 1), fecha_fin: null },
    ];
    data.fixed_expense_instances = [{ fixed_expense_id: "gym", mes: "2026-04", estado: "pagado", monto: null }];
    data.expenses = [{ id: "cc", account_id: "main", categoria_id: "x", monto: 120, fecha: d(2026, 3, 9), metodo_pago: "credito", mes_cargo: "2026-04" }];
    data.transfers = [{ id: "l", cuenta_origen: "sec", cuenta_destino: "main", monto: 200, fecha: d(2026, 2, 1), is_loan: true, status: "pending", outstanding_amount: 150 }];
    const tipos = new Set(core(data, "2026-04").pendingObligations("2026-04").map((o) => `${o.tipo}:${o.monto}`));
    expect(tipos).toEqual(new Set(["Gasto fijo:700", "Tarjeta:120", "Préstamo:150"]));
  });

  it("impacto de préstamos en ambos sentidos", () => {
    const data = emptyData();
    data.transfers = [
      { id: "a", cuenta_origen: "sec", cuenta_destino: "main", monto: 500, fecha: d(2026, 2, 1), is_loan: true, status: "pending", outstanding_amount: 300 },
      { id: "b", cuenta_origen: "main", cuenta_destino: "sec", monto: 100, fecha: d(2026, 3, 1), is_loan: true, status: "pending" },
      { id: "c", cuenta_origen: "sec", cuenta_destino: "main", monto: 900, fecha: d(2026, 3, 1), is_loan: true, status: "paid", outstanding_amount: 0 },
      { id: "d", cuenta_origen: "sec", cuenta_destino: "main", monto: 50, fecha: d(2026, 3, 1) },
    ];
    expect(core(data, "2026-04").pendingLoansImpact("main")).toEqual({ debes: 300, te_deben: 100, neto: -200 });
  });

  it("primer mes con datos", () => {
    const data = emptyData();
    expect(core(data, "2026-04").firstDataMonth()).toBeNull();
    data.salaries = [{ id: "s", fecha_inicio: d(2026, 3, 1), deductions: [] }];
    data.expenses = [{ id: "e", fecha: d(2025, 11, 5), monto: 1, categoria_id: "x" }];
    expect(core(data, "2026-04").firstDataMonth()).toBe("2025-11");
  });
});
