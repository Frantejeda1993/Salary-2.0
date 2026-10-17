/**
 * Datos de entrada del motor: listas planas, ordenadas, con la misma forma
 * lógica que load_all_data() de la app vieja. El orden importa: fija el orden de
 * las sumas y el reparto de la absorción de déficit entre budgets.
 *
 * fromDataset() reproduce exactamente tools/migrate/salary_migrate/reverse.py.
 */
import type { Dataset } from "./model";
import type { IsoDate, Month } from "./months";
import { cmp } from "./pymath";

export interface EAccount { id: string; isMain: boolean; initialBalance: number }
export interface ESalary {
  id: string; accountId: string | null; gross: number; start: IsoDate; end: IsoDate | null;
  deductions: { name: string | null; rate: number; appliesToExtras: boolean }[];
  revisions: { from: Month; gross: number; paidFrom?: Month }[];
}
export interface EOvertime { id: string; salaryId: string; month: Month; gross: number }
export interface EFixed {
  id: string; name: string; amount: number; start: IsoDate; end: IsoDate | null; accountId: string | null;
  isOwn: boolean; revisions: { from: Month; amount?: number; accountId?: string }[];
}
export interface EInstance { id: string; fixedId: string; month: Month; status: "pagado" | "impagado"; amount: number | null }
export interface EBudget {
  id: string; categoryId: string | null; accountId: string | null; amount: number; start: IsoDate; end: IsoDate | null;
  /** B3: nuevo importe a partir de un mes (como los gastos fijos). */
  revisions?: { from: Month; amount: number }[];
}
export interface EExpense {
  id: string; date: IsoDate; amount: number; categoryId: string; accountId: string | null;
  credit: boolean; chargeMonth: Month | null; reserveIn: "compra" | "cargo";
}
export interface EIncome { id: string; date: IsoDate; amount: number; categoryId: string; accountId: string | null }
export interface ETransfer {
  id: string; date: IsoDate; amount: number; from: string | null; to: string | null; description: string;
  isLoan: boolean; status: "pending" | "paid"; outstanding: number | null;
  /** Reembolso de gasto propio: transferKind 'ownExpenseRefund' (o la descripción automática de la app vieja). */
  isOwnRefund?: boolean;
}
export interface ESettlement { id: string; accountId: string; chargeMonth: Month; date: IsoDate; amount: number }

export interface EngineData {
  settings?: { ownExpensesFrom?: Month };
  accounts: EAccount[];
  salaries: ESalary[];
  overtimes: EOvertime[];
  fixedExpenses: EFixed[];
  instances: EInstance[];
  budgets: EBudget[];
  expenses: EExpense[];
  incomes: EIncome[];
  transfers: ETransfer[];
  settlements: ESettlement[];
}

const byId = <T extends { id: string }>(a: T, b: T) => cmp(a.id, b.id);
const entries = <T>(rec: Record<string, T> | undefined): [string, T][] =>
  Object.entries(rec ?? {}).sort((a, b) => cmp(a[0], b[0]));

export interface DataOptions {
  /** Importes en céntimos enteros (Fase 4b). Las tasas (deducciones) no cambian. */
  cents?: boolean;
}

export function fromDataset(ds: Dataset, opts: DataOptions = {}): EngineData {
  const out0 = fromDatasetEuros(ds);
  return opts.cents ? toCents(out0) : out0;
}

/** Euros -> céntimos enteros. Math.round absorbe la representación binaria (12.34 * 100 = 1233.999…). */
export function toCents(e: EngineData): EngineData {
  const c = (v: number) => Math.round(v * 100);
  const cn = (v: number | null) => (v === null ? null : c(v));
  return {
    settings: e.settings,
    accounts: e.accounts.map((a) => ({ ...a, initialBalance: c(a.initialBalance) })),
    salaries: e.salaries.map((s) => ({ ...s, gross: c(s.gross), revisions: s.revisions.map((r) => ({ ...r, gross: c(r.gross) })) })),
    overtimes: e.overtimes.map((o) => ({ ...o, gross: c(o.gross) })),
    fixedExpenses: e.fixedExpenses.map((f) => ({
      ...f, amount: c(f.amount), revisions: f.revisions.map((r) => (r.amount !== undefined ? { ...r, amount: c(r.amount) } : r)),
    })),
    instances: e.instances.map((i) => ({ ...i, amount: cn(i.amount) })),
    budgets: e.budgets.map((b) => ({ ...b, amount: c(b.amount), revisions: b.revisions?.map((r) => ({ ...r, amount: c(r.amount) })) })),
    expenses: e.expenses.map((x) => ({ ...x, amount: c(x.amount) })),
    incomes: e.incomes.map((x) => ({ ...x, amount: c(x.amount) })),
    transfers: e.transfers.map((t) => ({ ...t, amount: c(t.amount), outstanding: cn(t.outstanding) })),
    settlements: e.settlements.map((s) => ({ ...s, amount: c(s.amount) })),
  };
}

function fromDatasetEuros(ds: Dataset): EngineData {
  const d = ds.docs;
  const main = ds.profile.settings.mainAccountId;
  const out: EngineData = {
    settings: ds.profile.settings.ownExpensesFrom ? { ownExpensesFrom: ds.profile.settings.ownExpensesFrom } : undefined,
    accounts: [], salaries: [], overtimes: [], fixedExpenses: [], instances: [], budgets: [],
    expenses: [], incomes: [], transfers: [], settlements: [],
  };

  for (const [id, a] of entries(d.accounts)) {
    out.accounts.push({ id, isMain: id === main, initialBalance: a.initialBalance ?? 0 });
  }
  for (const [id, s] of entries(d.salaries)) {
    out.salaries.push({
      id, accountId: s.accountId ?? null, gross: s.grossMonthly ?? 0, start: s.start, end: s.end ?? null,
      deductions: (s.deductions ?? []).map((x) => ({ name: x.name ?? null, rate: x.rate ?? 0, appliesToExtras: x.appliesToExtras ?? false })),
      revisions: (s.revisions ?? []).map((r) => ({ from: r.from, gross: r.gross, ...(r.paidFrom ? { paidFrom: r.paidFrom } : {}) })),
    });
    for (const o of s.overtimes ?? []) out.overtimes.push({ id: o.id, salaryId: id, month: o.month, gross: o.gross });
  }
  out.overtimes.sort(byId);

  for (const [id, f] of entries(d.fixedExpenses)) {
    out.fixedExpenses.push({
      id, name: f.name ?? "", amount: f.amount ?? 0, start: f.start, end: f.end ?? null, accountId: f.accountId ?? null,
      isOwn: f.isOwnExpense ?? false,
      revisions: (f.revisions ?? []).map((r) => ({
        from: r.from,
        ...("amount" in r && r.amount !== undefined ? { amount: r.amount } : {}),
        ...("accountId" in r && r.accountId !== undefined ? { accountId: r.accountId } : {}),
      })),
    });
    for (const [month, p] of entries(f.payments)) {
      out.instances.push({
        id: p.legacyId || `${id}_${month}`, fixedId: id, month,
        status: p.status === "paid" ? "pagado" : "impagado", amount: p.amount ?? null,
      });
    }
  }
  out.instances.sort(byId);

  for (const [id, b] of entries(d.budgets)) {
    out.budgets.push({
      id, categoryId: b.categoryId ?? null, accountId: b.accountId ?? null, amount: b.amount, start: b.start, end: b.end ?? null,
      ...(b.revisions?.length ? { revisions: b.revisions.map((r) => ({ from: r.from, amount: r.amount })) } : {}),
    });
  }

  for (const [id, m] of entries(d.movements)) {
    if (m.type === "expense") {
      out.expenses.push({
        id, date: m.date, amount: m.amount, categoryId: m.categoryId || "", accountId: m.accountId ?? null,
        credit: !!m.card, chargeMonth: m.card?.chargeMonth ?? null,
        reserveIn: m.card?.reserveIn === "charge" ? "cargo" : "compra",
      });
    } else if (m.type === "income") {
      out.incomes.push({ id, date: m.date, amount: m.amount, categoryId: m.categoryId || "", accountId: m.accountId ?? null });
    } else {
      const isLoan = m.transferKind === "loan";
      out.transfers.push({
        id, date: m.date, amount: m.amount, from: m.accountId ?? null, to: m.toAccountId ?? null,
        description: m.description ?? "", isLoan,
        isOwnRefund: m.transferKind === "ownExpenseRefund" || m.description === "Transferencia automatica gastos",
        status: m.loan?.status ?? "pending", outstanding: m.loan ? m.loan.outstanding : null,
      });
    }
  }

  for (const [id, s] of entries(d.cardSettlements)) {
    out.settlements.push({ id: s.legacy?.id || id, accountId: s.accountId, chargeMonth: s.chargeMonth, date: s.date, amount: s.amount });
  }
  out.settlements.sort(byId);
  return out;
}
