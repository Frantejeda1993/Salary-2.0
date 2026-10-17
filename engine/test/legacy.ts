/**
 * Ayudas para portar los tests del repo viejo casi literalmente: construyen los
 * datos con la forma de load_all_data() (nombres en español) y los convierten a EngineData.
 */
import type { EngineData } from "../src";

export const d = (y: number, m: number, day = 15) =>
  `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

type Row = Record<string, any>;
export interface Legacy {
  accounts: Row[]; salaries: Row[]; overtimes: Row[]; expenses: Row[]; incomes: Row[]; transfers: Row[];
  categories: Row[]; budgets: Row[]; fixed_expenses: Row[]; fixed_expense_instances: Row[]; credit_settlements: Row[];
}

export const emptyData = (): Legacy => ({
  accounts: [], salaries: [], overtimes: [], expenses: [], incomes: [], transfers: [], categories: [],
  budgets: [], fixed_expenses: [], fixed_expense_instances: [], credit_settlements: [],
});

let auto = 0;
const id = (r: Row, p: string) => r.id ?? `${p}${String(++auto).padStart(5, "0")}`;

export function toEngine(L: Legacy): EngineData {
  return {
    accounts: L.accounts.map((a) => ({ id: a.id, isMain: !!a.is_main, initialBalance: a.saldo_inicial ?? 0 })),
    salaries: L.salaries.map((s) => ({
      id: s.id, accountId: s.account_id ?? null, gross: s.salario_bruto ?? 0, start: s.fecha_inicio, end: s.fecha_fin ?? null,
      deductions: (s.deductions ?? []).map((x: Row) => ({ name: x.name ?? null, rate: x.percentage ?? 0, appliesToExtras: x.applies_to_extras ?? false })),
      revisions: (s.revisiones ?? []).map((r: Row) => ({ from: r.desde, gross: r.salario_bruto, ...(r.cobro_desde ? { paidFrom: r.cobro_desde } : {}) })),
    })),
    overtimes: L.overtimes.map((o) => ({ id: id(o, "ot"), salaryId: o.salary_id, month: o.mes_aplicacion, gross: o.monto_bruto })),
    fixedExpenses: L.fixed_expenses.map((f) => ({
      id: f.id, name: f.nombre ?? "", amount: f.monto ?? 0, start: f.fecha_inicio, end: f.fecha_fin ?? null,
      accountId: f.account_id ?? null, isOwn: !!f.es_propio,
      revisions: (f.revisiones ?? []).map((r: Row) => ({
        from: r.desde, ...(r.monto != null ? { amount: r.monto } : {}), ...(r.account_id != null ? { accountId: r.account_id } : {}),
      })),
    })),
    instances: L.fixed_expense_instances.map((i) => ({
      id: id(i, "i"), fixedId: i.fixed_expense_id, month: i.mes, status: i.estado, amount: i.monto ?? null,
    })),
    budgets: L.budgets.map((b) => ({
      id: b.id, categoryId: b.categoria_id ?? null, accountId: b.account_id ?? null, amount: b.monto, start: b.fecha_inicio, end: b.fecha_fin ?? null,
    })),
    expenses: L.expenses.map((e) => ({
      id: id(e, "e"), date: e.fecha, amount: e.monto, categoryId: e.categoria_id ?? "", accountId: e.account_id ?? null,
      credit: e.metodo_pago === "credito", chargeMonth: e.mes_cargo ?? null, reserveIn: e.reservar_en === "cargo" ? "cargo" : "compra",
    })),
    incomes: L.incomes.map((i) => ({ id: id(i, "in"), date: i.fecha, amount: i.monto, categoryId: i.categoria_id ?? "", accountId: i.account_id ?? null })),
    transfers: L.transfers.map((t) => ({
      id: id(t, "t"), date: t.fecha, amount: t.monto, from: t.cuenta_origen ?? null, to: t.cuenta_destino ?? null,
      description: t.descripcion ?? "", isLoan: !!t.is_loan, status: t.status ?? "pending",
      outstanding: t.outstanding_amount ?? null,
      isOwnRefund: t.descripcion === "Transferencia automatica gastos",
    })),
    // Mismo orden en que se escriben, igual que las listas de los tests de Python.
    settlements: L.credit_settlements.map((s) => ({ id: id(s, "st"), accountId: s.account_id, chargeMonth: s.mes_cargo, date: s.fecha, amount: s.monto })),
  };
}
