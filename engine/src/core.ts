/**
 * Port 1:1 de services/finance_core.py (repo Frantejeda1993/Salary, commit b93f352).
 *
 * Fase 4a: misma lógica, mismos bugs, mismo orden de operaciones. Cada método
 * lleva el nombre del método Python que porta. Convenciones:
 *   - `sum(...)` de Python  -> pySum(...)   (suma compensada de Neumaier)
 *   - `x += y` de Python    -> x += y
 *   - dict de Python        -> Map (conserva el orden de inserción)
 * Las correcciones acordadas (B1, B2, A1, B3, B5–B7, D5, D8) llegan en la Fase 4b.
 */
import type { EBudget, EExpense, EngineData, ESalary, ESettlement, ETransfer } from "./data";
import { addMonths, isActiveInMonth, monthOf, monthRange, type IsoDate, type Month } from "./months";
import { cmp, pyMax, pyMin, pySum } from "./pymath";

export const AUTO_TRANSFER_DESCRIPTION = "Transferencia automatica gastos";

// ----------------------------------------------------------------------------- tarjeta

export const isCredit = (e: EExpense) => e.credit;

export function chargeMonth(e: EExpense): Month {
  return e.chargeMonth || addMonths(monthOf(e.date), 1);
}

export function reserveMonth(e: EExpense): Month {
  return e.reserveIn === "cargo" ? chargeMonth(e) : monthOf(e.date);
}

/** Mes en el que un gasto cuenta para proyectado y budgets. */
export function accrualMonth(e: EExpense): Month {
  return isCredit(e) ? reserveMonth(e) : monthOf(e.date);
}

// ----------------------------------------------------------------------------- revisiones de fijos

type FixedLike = EngineData["fixedExpenses"][number];

function feFieldForMonth<K extends "amount" | "accountId">(fe: FixedLike, field: K, month: Month): FixedLike[K] {
  let value = fe[field];
  const revs = [...fe.revisions].sort((a, b) => cmp(a.from, b.from));
  for (const rev of revs) {
    const v = rev[field];
    if (rev.from <= month && v !== undefined && v !== null) value = v as unknown as FixedLike[K];
  }
  return value;
}

export const fixedAmountForMonth = (fe: FixedLike, month: Month) => feFieldForMonth(fe, "amount", month) ?? 0;
export const fixedAccountForMonth = (fe: FixedLike, month: Month) => feFieldForMonth(fe, "accountId", month);

const active = (item: { start: IsoDate; end: IsoDate | null }, month: Month) => isActiveInMonth(item.start, item.end, month);

// ----------------------------------------------------------------------------- absorción

export interface BudgetDetail {
  budget_id: string;
  categoria_id: string | null;
  presupuesto: number;
  real_spent: number;
  available: number;
  absorbed?: number;
}

/** _absorb_deficit: cubre un resultado negativo con el margen de los budgets, en proporción. */
function absorbDeficit(resultado: number, details: BudgetDetail[], trackAbsorbed: boolean): number {
  if (resultado >= 0) return resultado;
  const positive = details.filter((bd) => bd.available > 0);
  const totalAvailable = pySum(positive.map((bd) => bd.available));
  if (totalAvailable <= 0) return resultado;
  const absorption = pyMin(Math.abs(resultado), totalAvailable);
  let remaining = absorption;
  positive.forEach((bd, i) => {
    let share: number;
    if (i === positive.length - 1) {
      share = remaining;
    } else {
      share = absorption * (bd.available / totalAvailable);
      remaining -= share;
    }
    if (trackAbsorbed) bd.absorbed = share;
    bd.available -= share;
  });
  return resultado + absorption;
}

// ----------------------------------------------------------------------------- resultados públicos

export interface FixedForMonth {
  id: string; name: string; isOwn: boolean;
  monto: number; account_id: string | null;
  estado: "pagado" | "impagado"; monto_pagado: number | null;
}
export interface SalaryBreakdown { base: number; atrasos: number; horas_extra: number; deducciones: number; neto: number }
export interface ProjectedResult {
  resultado: number; resultado_pre_absorcion: number; budget_details: BudgetDetail[]; deuda_tarjeta_arrastrada: number;
}
export interface CreditGroup { account_id: string | null; mes_cargo: Month; total: number; items: EExpense[]; settlement: ESettlement | null }
export interface Obligation { tipo: "Gasto fijo" | "Tarjeta" | "Reembolso propio" | "Préstamo"; concepto: string; account_id: string | null; monto: number }
export interface MonthSummary {
  ingreso_total: number; gastos_fijos: number; presupuestos: number; gastos_reales: number; ingresos_extra: number;
  remaining_from_previous_month: number; resultado_real: number; resultado_proyectado: number;
  resultado_proyectado_pre_absorcion: number; deuda_tarjeta_arrastrada?: number;
  resultado_real_details: null | { main_account_id: string; pending_loans: ETransfer[] };
}

// ----------------------------------------------------------------------------- núcleo

export class FinanceCore {
  private cache = new Map<string, unknown>();
  private settlementsByKey: Map<string, ESettlement>;

  constructor(
    readonly data: EngineData,
    readonly currentMonth: Month,
    readonly minManagedMonth: Month,
  ) {
    // dict comprehension de Python: ante claves repetidas gana la última.
    this.settlementsByKey = new Map(data.settlements.map((s) => [`${s.accountId}|${s.chargeMonth}`, s]));
  }

  private memo<T>(key: string, fn: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as T;
  }

  // ----- lookups

  settledMonth(e: EExpense): Month | null {
    const st = this.settlementsByKey.get(`${e.accountId}|${chargeMonth(e)}`);
    return st ? monthOf(st.date) : null;
  }

  private creditExpenses(accountId: string): EExpense[] {
    return this.data.expenses.filter((e) => isCredit(e) && e.accountId === accountId);
  }

  private cashExpenses(): EExpense[] {
    return this.data.expenses.filter((e) => !isCredit(e));
  }

  creditDebtCarriedInto(accountId: string, month: Month): number {
    return this.memo(`cdci|${accountId}|${month}`, () => {
      if (month > this.currentMonth) return 0;
      let total = 0;
      for (const e of this.creditExpenses(accountId)) {
        if (reserveMonth(e) >= month) continue;
        const settled = this.settledMonth(e);
        if (settled === null || settled >= month) total += e.amount ?? 0;
      }
      return total;
    });
  }

  creditOutstanding(accountId: string, month: Month, reservedOnly = true): number {
    return this.memo(`co|${accountId}|${month}|${reservedOnly}`, () => {
      let total = 0;
      for (const e of this.creditExpenses(accountId)) {
        const ref = reservedOnly ? reserveMonth(e) : monthOf(e.date);
        if (ref > month) continue;
        const settled = this.settledMonth(e);
        if (settled === null || settled > month) total += e.amount ?? 0;
      }
      return total;
    });
  }

  creditGroups(): CreditGroup[] {
    const groups = new Map<string, CreditGroup>();
    for (const e of this.data.expenses) {
      if (!isCredit(e)) continue;
      const key = `${e.accountId}|${chargeMonth(e)}`;
      let g = groups.get(key);
      if (!g) {
        g = { account_id: e.accountId, mes_cargo: chargeMonth(e), total: 0, items: [], settlement: this.settlementsByKey.get(key) ?? null };
        groups.set(key, g);
      }
      g.total += e.amount ?? 0;
      g.items.push(e);
    }
    return [...groups.values()].sort((a, b) => cmp(a.mes_cargo, b.mes_cargo) || cmp(a.account_id ?? "", b.account_id ?? ""));
  }

  private settlementsIn(accountId: string, month: Month): number {
    return pySum(this.data.settlements.filter((s) => s.accountId === accountId && monthOf(s.date) === month).map((s) => s.amount ?? 0));
  }

  private salariesFor(accountId: string, month: Month): number {
    return pySum(this.data.salaries.filter((s) => s.accountId === accountId && active(s, month)).map((s) => this.salaryNet(s.id, month)));
  }

  private sumIncomes(accountId: string, month: Month): number {
    return pySum(this.data.incomes.filter((x) => x.accountId === accountId && monthOf(x.date) === month).map((x) => x.amount));
  }

  private sumTransfers(field: "from" | "to", accountId: string, month: Month): number {
    return pySum(this.data.transfers.filter((x) => x[field] === accountId && monthOf(x.date) === month).map((x) => x.amount));
  }

  // ----- salarios

  private salary(id: string): ESalary | undefined {
    return this.data.salaries.find((s) => s.id === id);
  }

  /** _gross_owed: bruto debido en `month`, contando solo subidas ya cobradas en `knownAt`. */
  static grossOwed(salary: ESalary, month: Month, knownAt: Month): number {
    let gross = salary.gross ?? 0;
    const revs = [...salary.revisions].sort((a, b) => cmp(a.from, b.from));
    for (const rev of revs) {
      if (rev.from <= month && (rev.paidFrom || rev.from) <= knownAt) gross = rev.gross;
    }
    return gross;
  }

  private grossCumulative(salaryId: string, upTo: Month, knownAt: Month): number {
    return this.memo(`gc|${salaryId}|${upTo}|${knownAt}`, () => {
      const salary = this.salary(salaryId)!;
      let m = monthOf(salary.start);
      let total = 0;
      while (m <= upTo) {
        if (active(salary, m)) total += FinanceCore.grossOwed(salary, m, knownAt);
        m = addMonths(m, 1);
      }
      return total;
    });
  }

  salaryBreakdown(salaryId: string, month: Month): SalaryBreakdown {
    return this.memo(`sb|${salaryId}|${month}`, () => {
      const salary = this.salary(salaryId);
      if (!salary) return { base: 0, atrasos: 0, horas_extra: 0, deducciones: 0, neto: 0 };
      let base: number;
      let atrasos: number;
      if (salary.revisions.length > 0) {
        base = FinanceCore.grossOwed(salary, month, month);
        const prev = addMonths(month, -1);
        const paid = this.grossCumulative(salaryId, month, month) - this.grossCumulative(salaryId, prev, prev);
        atrasos = active(salary, month) ? paid - base : 0;
      } else {
        base = salary.gross ?? 0;
        atrasos = 0;
      }
      const overtime = pySum(this.data.overtimes.filter((o) => o.salaryId === salaryId && o.month === month).map((o) => o.gross ?? 0));
      const deducciones = pySum(
        salary.deductions.filter((d) => d.name).map((d) => (base + atrasos + (d.appliesToExtras ? overtime : 0)) * (d.rate ?? 0)),
      );
      return { base, atrasos, horas_extra: overtime, deducciones, neto: base + atrasos + overtime - deducciones };
    });
  }

  salaryNet(salaryId: string, month: Month): number {
    return this.salaryBreakdown(salaryId, month).neto;
  }

  // ----- bloques del mes

  activeBudgets(month: Month): EBudget[] {
    return this.memo(`ab|${month}`, () => this.data.budgets.filter((b) => active(b, month)));
  }

  fixedExpensesForMonth(month: Month): FixedForMonth[] {
    return this.memo(`fem|${month}`, () => {
      const byFe = new Map<string, EngineData["instances"]>();
      for (const inst of this.data.instances) {
        if (inst.fixedId) {
          if (!byFe.has(inst.fixedId)) byFe.set(inst.fixedId, []);
          byFe.get(inst.fixedId)!.push(inst);
        }
      }
      const result: FixedForMonth[] = [];
      for (const fe of this.data.fixedExpenses) {
        if (!active(fe, month)) continue;
        const inst = (byFe.get(fe.id) ?? []).find((i) => i.month === month);
        result.push({
          id: fe.id, name: fe.name, isOwn: fe.isOwn,
          monto: fixedAmountForMonth(fe, month),
          account_id: fixedAccountForMonth(fe, month),
          estado: inst ? inst.status : "impagado",
          monto_pagado: inst ? inst.amount : null,
        });
      }
      return result;
    });
  }

  rawCategoryExpenses(month: Month, accountId: string | null = null): Map<string, number> {
    return this.memo(`rce|${month}|${accountId}`, () => {
      const raw = new Map<string, number>();
      for (const exp of this.data.expenses) {
        if (accountId && exp.accountId !== accountId) continue;
        if (accrualMonth(exp) === month) {
          const cat = exp.categoryId ?? "";
          raw.set(cat, (raw.get(cat) ?? 0) + (exp.amount ?? 0));
        }
      }
      return raw;
    });
  }

  pendingLoansForAccount(accountId: string, month: Month | null = null): ETransfer[] {
    return this.memo(`pl|${accountId}|${month}`, () => {
      let pending = this.data.transfers.filter(
        (t) => t.to === accountId && t.isLoan && (t.status ?? "pending") === "pending" && outstandingOf(t) > 0,
      );
      if (month) pending = pending.filter((t) => monthOf(t.date) === month);
      return pending;
    });
  }

  /** Gastos propios impagados de cuentas no principales, menos los reembolsos automáticos del mes. */
  propioExpensesByAccount(month: Month, mainAccountId: string): Map<string, number> {
    return this.memo(`prop|${month}|${mainAccountId}`, () => {
      const result = new Map<string, number>();
      for (const fe of this.fixedExpensesForMonth(month)) {
        if (!fe.isOwn || (fe.estado ?? "impagado") !== "impagado") continue;
        const acc = fe.account_id;
        if (acc && acc !== mainAccountId) result.set(acc, (result.get(acc) ?? 0) + (fe.monto ?? 0));
      }
      for (const trf of this.data.transfers) {
        if (trf.from !== mainAccountId || trf.description !== AUTO_TRANSFER_DESCRIPTION || monthOf(trf.date) !== month) continue;
        const acc = trf.to;
        if (acc && result.has(acc)) result.set(acc, pyMax(0, result.get(acc)! - (trf.amount ?? 0)));
      }
      return new Map([...result].filter(([, amt]) => amt > 0));
    });
  }

  // ----- resultados del mes

  monthRealResult(accountId: string, month: Month): number {
    return this.memo(`mrr|${accountId}|${month}`, () => {
      const income = this.salariesFor(accountId, month) + this.sumIncomes(accountId, month) + this.sumTransfers("to", accountId, month);
      const fixedPaid = pySum(
        this.fixedExpensesForMonth(month)
          .filter((fe) => fe.account_id === accountId && fe.estado === "pagado")
          .map((fe) => (fe.monto_pagado !== null ? fe.monto_pagado : fe.monto)),
      );
      const cash = pySum(this.cashExpenses().filter((e) => e.accountId === accountId && monthOf(e.date) === month).map((e) => e.amount));
      const expense = cash + this.settlementsIn(accountId, month) + fixedPaid + this.sumTransfers("from", accountId, month);
      return income - expense;
    });
  }

  monthProjectedResult(accountId: string, month: Month, remainingFromPrevious = 0): ProjectedResult {
    return this.memo(`mpr|${accountId}|${month}|${remainingFromPrevious}`, () => {
      const income = this.salariesFor(accountId, month) + this.sumIncomes(accountId, month) + this.sumTransfers("to", accountId, month);
      const transfersOut = this.sumTransfers("from", accountId, month);
      const fixedTotal = pySum(
        this.fixedExpensesForMonth(month)
          .filter((fe) => fe.account_id === accountId)
          .map((fe) => (fe.monto_pagado !== null ? fe.monto_pagado : fe.monto)),
      );
      const budgets = this.activeBudgets(month).filter((b) => b.accountId === accountId);
      const raw = this.rawCategoryExpenses(month, accountId);

      let budgetImpact = 0;
      const details: BudgetDetail[] = [];
      for (const b of budgets) {
        const spent = raw.get(b.categoryId as string) ?? 0;
        budgetImpact += pyMax(b.amount, pyMax(spent, 0));
        details.push({
          budget_id: b.id, categoria_id: b.categoryId, presupuesto: b.amount, real_spent: spent,
          available: b.amount - pyMax(spent, 0), absorbed: 0,
        });
      }
      const budgetCats = new Set(budgets.map((b) => b.categoryId));
      const nonBudgeted = pySum([...raw].filter(([cat]) => !budgetCats.has(cat)).map(([, v]) => v));
      const creditCarried = this.creditDebtCarriedInto(accountId, month);

      const pre = income + remainingFromPrevious - fixedTotal - budgetImpact - nonBudgeted - transfersOut - creditCarried;
      const resultado = absorbDeficit(pre, details, true);
      return { resultado, resultado_pre_absorcion: pre, budget_details: details, deuda_tarjeta_arrastrada: creditCarried };
    });
  }

  remainingFromPreviousMonth(month: Month, mainAccountId: string): number {
    return this.memo(`rfpm|${month}|${mainAccountId}`, () => {
      if (month <= this.minManagedMonth) return 0;
      const prev = addMonths(month, -1);
      if (prev < this.minManagedMonth) return 0;
      if (prev < this.currentMonth) {
        return this.monthRealResult(mainAccountId, prev) + this.remainingFromPreviousMonth(prev, mainAccountId);
      }
      let carry = addMonths(this.currentMonth, -1) >= this.minManagedMonth
        ? this.remainingFromPreviousMonth(this.currentMonth, mainAccountId)
        : 0;
      for (let m = this.currentMonth; m <= prev; m = addMonths(m, 1)) {
        const proj = this.monthProjectedResult(mainAccountId, m, carry);
        const propios = pySum(this.propioExpensesByAccount(m, mainAccountId).values());
        carry = proj.resultado - propios;
      }
      return carry;
    });
  }

  // ----- saldos acumulados

  historicalSalaryIncomes(accountId: string, upToMonth: Month | null = null): number {
    return this.memo(`hsi|${accountId}|${upToMonth}`, () => {
      const target = upToMonth || this.currentMonth;
      let total = 0;
      for (const s of this.data.salaries) {
        if (s.accountId !== accountId) continue;
        let endItr = target;
        if (s.end && monthOf(s.end) < endItr) endItr = monthOf(s.end);
        for (const m of monthRange(monthOf(s.start), endItr)) {
          if (isActiveInMonth(s.start, s.end, m)) total += this.salaryNet(s.id, m);
        }
      }
      return total;
    });
  }

  realBalance(accountId: string, month: Month | null = null): number {
    return this.memo(`rb|${accountId}|${month}`, () => {
      const account = this.data.accounts.find((a) => a.id === accountId);
      if (!account) return 0;
      const target = month || this.currentMonth;
      const upto = <T extends { date: IsoDate; amount: number }>(items: T[], pred: (x: T) => boolean) =>
        pySum(items.filter((x) => pred(x) && monthOf(x.date) <= target).map((x) => x.amount ?? 0));

      let balance = account.initialBalance ?? 0;
      balance += this.historicalSalaryIncomes(accountId, target);
      balance += upto(this.data.incomes, (x) => x.accountId === accountId);
      balance -= upto(this.cashExpenses(), (e) => e.accountId === accountId);
      balance -= upto(this.data.settlements, (s) => s.accountId === accountId);

      const fes = new Map(this.data.fixedExpenses.map((fe) => [fe.id, fe]));
      for (const inst of this.data.instances) {
        const fe = fes.get(inst.fixedId);
        if (fe && inst.status === "pagado" && (inst.month ?? "") <= target && fixedAccountForMonth(fe, inst.month) === accountId) {
          balance -= inst.amount !== null ? inst.amount : fixedAmountForMonth(fe, inst.month);
        }
      }
      balance -= upto(this.data.transfers, (t) => t.from === accountId);
      balance += upto(this.data.transfers, (t) => t.to === accountId);
      return balance;
    });
  }

  projectedBalance(accountId: string, month: Month | null = null): { resultado: number; budget_details: BudgetDetail[] } {
    return this.memo(`pb|${accountId}|${month}`, () => {
      const target = month || this.currentMonth;
      const real = this.realBalance(accountId, target);
      const fixedPending = pySum(
        this.fixedExpensesForMonth(target).filter((fe) => fe.account_id === accountId && fe.estado === "impagado").map((fe) => fe.monto),
      );
      const raw = this.rawCategoryExpenses(target, accountId);
      const details: BudgetDetail[] = [];
      let pendingBudget = 0;
      for (const b of this.activeBudgets(target)) {
        if (b.accountId !== accountId) continue;
        const spent = raw.get(b.categoryId as string) ?? 0;
        const effective = pyMax(spent, 0);
        details.push({ budget_id: b.id, categoria_id: b.categoryId, presupuesto: b.amount, real_spent: spent, available: b.amount - effective });
        if (effective < b.amount) pendingBudget += b.amount - effective;
      }
      const creditPending = this.creditOutstanding(accountId, target, true);
      const resultado = absorbDeficit(real - fixedPending - pendingBudget - creditPending, details, false);
      return { resultado, budget_details: details };
    });
  }

  // ----- dashboard

  firstDataMonth(): Month | null {
    const months: Month[] = [];
    for (const x of [...this.data.salaries, ...this.data.fixedExpenses, ...this.data.budgets]) if (x.start) months.push(monthOf(x.start));
    for (const x of [...this.data.expenses, ...this.data.incomes, ...this.data.transfers]) if (x.date) months.push(monthOf(x.date));
    return months.length ? months.reduce((a, b) => (b < a ? b : a)) : null;
  }

  pendingObligations(month: Month): Obligation[] {
    return this.memo(`po|${month}`, () => {
      const out: Obligation[] = [];
      for (const fe of this.fixedExpensesForMonth(month)) {
        if (fe.estado === "impagado") out.push({ tipo: "Gasto fijo", concepto: fe.name, account_id: fe.account_id, monto: fe.monto });
      }
      for (const g of this.creditGroups()) {
        if (g.mes_cargo <= month && g.settlement === null) {
          out.push({ tipo: "Tarjeta", concepto: `Cargo ${g.mes_cargo}`, account_id: g.account_id, monto: g.total });
        }
      }
      const main = this.data.accounts.find((a) => a.isMain);
      if (main) {
        for (const [acc, amt] of this.propioExpensesByAccount(month, main.id)) {
          out.push({ tipo: "Reembolso propio", concepto: "Transferir a cuenta", account_id: acc, monto: amt });
        }
        for (const loan of this.pendingLoansForAccount(main.id)) {
          out.push({ tipo: "Préstamo", concepto: `Desde ${loan.from ?? ""}`, account_id: main.id, monto: outstandingOf(loan) });
        }
      }
      return out;
    });
  }

  pendingLoansImpact(accountId: string): { debes: number; te_deben: number; neto: number } {
    return this.memo(`pli|${accountId}`, () => {
      let debes = 0;
      let teDeben = 0;
      for (const t of this.data.transfers) {
        if (!t.isLoan || (t.status ?? "pending") !== "pending") continue;
        const outstanding = outstandingOf(t);
        if (outstanding <= 0) continue;
        if (t.to === accountId) debes += outstanding;
        else if (t.from === accountId) teDeben += outstanding;
      }
      return { debes, te_deben: teDeben, neto: teDeben - debes };
    });
  }

  static budgetPace(used: number, limit: number, day: number, daysInMonth: number) {
    const elapsed = pyMax(day, 1) / daysInMonth;
    const forecast = used / elapsed;
    const status = used > limit ? "excedido" : forecast > limit ? "por encima del ritmo" : "ok";
    return { forecast, elapsed, used_pct: limit ? used / limit : 0, status };
  }

  // ----- resumen

  monthSummary(month: Month): MonthSummary {
    return this.memo(`ms|${month}`, () => {
      const d = this.data;
      const main = d.accounts.find((a) => a.isMain);
      const summary: MonthSummary = {
        ingreso_total: pySum(d.salaries.filter((s) => active(s, month)).map((s) => this.salaryNet(s.id, month))),
        gastos_fijos: pySum(this.fixedExpensesForMonth(month).map((fe) => fe.monto)),
        presupuestos: pySum(this.activeBudgets(month).map((b) => b.amount)),
        gastos_reales: pySum(d.expenses.filter((e) => monthOf(e.date) === month).map((e) => e.amount)),
        ingresos_extra: pySum(d.incomes.filter((i) => monthOf(i.date) === month).map((i) => i.amount)),
        remaining_from_previous_month: 0,
        resultado_real: 0,
        resultado_proyectado: 0,
        resultado_proyectado_pre_absorcion: 0,
        resultado_real_details: null,
      };
      if (main) {
        const carry = this.remainingFromPreviousMonth(month, main.id);
        const proj = this.monthProjectedResult(main.id, month, carry);
        Object.assign(summary, {
          remaining_from_previous_month: carry,
          resultado_real: this.monthRealResult(main.id, month) + carry,
          resultado_proyectado: proj.resultado,
          resultado_proyectado_pre_absorcion: proj.resultado_pre_absorcion,
          deuda_tarjeta_arrastrada: proj.deuda_tarjeta_arrastrada,
          resultado_real_details: { main_account_id: main.id, pending_loans: this.pendingLoansForAccount(main.id) },
        });
      }
      return summary;
    });
  }
}

/** t.get("outstanding_amount", t.get("monto", 0.0)) */
export function outstandingOf(t: ETransfer): number {
  return t.outstanding !== null && t.outstanding !== undefined ? t.outstanding : (t.amount ?? 0);
}
