/**
 * Motor de cálculo de Salary 2.0.
 *
 * Base: port 1:1 de services/finance_core.py (repo Frantejeda1993/Salary, commit
 * b93f352), Fase 4a. Convenciones para que sea idéntico bit a bit:
 *   - `sum(...)` de Python  -> pySum(...)   (suma compensada de Neumaier)
 *   - `x += y` de Python    -> x += y
 *   - dict de Python        -> Map (conserva el orden de inserción)
 *
 * Fase 4b: correcciones acordadas, cada una tras una opción (EngineOptions).
 * Con LEGACY_OPTIONS el motor reproduce exactamente la app vieja (lo comprueban
 * los ficheros de fixtures/reference); con CURRENT_OPTIONS es el motor corregido.
 * Ver docs en engine/README.md y la especificación (registro de decisiones).
 */
import type { EBudget, EExpense, EngineData, ESalary, ESettlement, ETransfer } from "./data";
import { addMonths, isActiveInMonth, monthOf, monthRange, type IsoDate, type Month } from "./months";
import { cmp, pyMax, pyMin, pySum } from "./pymath";

export const AUTO_TRANSFER_DESCRIPTION = "Transferencia automatica gastos";

export interface EngineOptions {
  /** B6: un pago de un gasto fijo fuera de su periodo se ignora (antes restaba en el saldo real). */
  fixB6: boolean;
  /** B1: el saldo proyectado de un mes futuro encadena el proyectado de los meses intermedios. */
  fixB1: boolean;
  /** D3 + A1: gastos propios acumulados hasta reembolsarse; el proyectado mostrado es lo que se arrastra. */
  fixD3: boolean;
  /** Cálculo en céntimos enteros: los datos deben venir en céntimos (fromDataset(ds, { cents: true })). */
  cents: boolean;
  /** C: los pagos de tarjeta se agrupan por tarjeta y mes de cargo (antes, por cuenta y mes). */
  perCardSettlement?: boolean;
}

export const LEGACY_OPTIONS: EngineOptions = Object.freeze({ fixB6: false, fixB1: false, fixD3: false, cents: false, perCardSettlement: false });
export const CURRENT_OPTIONS: EngineOptions = Object.freeze({ fixB6: true, fixB1: true, fixD3: true, cents: true, perCardSettlement: true });

/** Redondeo al entero más cercano, mitades hacia fuera (como una nómina), tolerante al ruido binario. */
export function roundHalfUp(v: number): number {
  const r = Math.floor(Math.abs(v) + 0.5 + 1e-9);
  return v < 0 ? -r : r;
}

/** Importe de un budget en un mes, con sus revisiones (B3). Sin revisiones: su importe. */
export function budgetAmountForMonth(b: EBudget, month: Month): number {
  let value = b.amount;
  for (const r of [...(b.revisions ?? [])].sort((x, y) => cmp(x.from, y.from))) {
    if (r.from <= month) value = r.amount;
  }
  return value;
}

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

function feFieldForMonth<K extends "amount" | "accountId" | "isOwn">(fe: FixedLike, field: K, month: Month): FixedLike[K] {
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
/** B: «gasto propio» vigente en un mes. */
export const fixedIsOwnForMonth = (fe: FixedLike, month: Month) => !!feFieldForMonth(fe, "isOwn", month);

/** A: deducciones vigentes en un mes (la última revisión con from <= mes; si no hay, las de base). */
export function deductionsForMonth(salary: ESalary, month: Month): ESalary["deductions"] {
  let deds = salary.deductions;
  for (const r of [...(salary.deductionRevisions ?? [])].sort((a, b) => cmp(a.from, b.from))) {
    if (r.from <= month) deds = r.deductions;
  }
  return deds;
}

const active = (item: { start: IsoDate; end: IsoDate | null }, month: Month) => isActiveInMonth(item.start, item.end, month);

// ----------------------------------------------------------------------------- absorción

export interface BudgetDetail {
  budget_id: string;
  categoria_id: string | null;
  presupuesto: number;
  real_spent: number;
  available: number;
  /** Gastos fijos marcados para contar en este budget (ya se descuentan como fijos). */
  fixed_in_budget?: number;
  absorbed?: number;
}

/** _absorb_deficit: cubre un resultado negativo con el margen de los budgets, en proporción. */
function absorbDeficit(resultado: number, details: BudgetDetail[], trackAbsorbed: boolean, cents = false): number {
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
      if (cents) share = roundHalfUp(share); // el último se lleva el resto: el total cuadra al céntimo
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
export interface DeductionLine { name: string; rate: number; amount: number }
export interface SalaryBreakdown { base: number; atrasos: number; horas_extra: number; deducciones: number; neto: number }
export interface ProjectedResult {
  resultado: number; resultado_pre_absorcion: number; budget_details: BudgetDetail[]; deuda_tarjeta_arrastrada: number;
}
export interface CreditGroup {
  account_id: string | null; mes_cargo: Month; total: number; items: EExpense[]; settlement: ESettlement | null;
  /** Con perCardSettlement: la tarjeta del grupo. */
  card_id?: string | null;
}
export interface Obligation { tipo: "Gasto fijo" | "Tarjeta" | "Reembolso propio" | "Préstamo"; concepto: string; account_id: string | null; monto: number }
export interface MonthSummary {
  ingreso_total: number; gastos_fijos: number; presupuestos: number; gastos_reales: number; ingresos_extra: number;
  remaining_from_previous_month: number; resultado_real: number; resultado_proyectado: number;
  resultado_proyectado_pre_absorcion: number; deuda_tarjeta_arrastrada?: number;
  /** D3: reembolsos de gastos propios pendientes que el proyectado ya descuenta (solo con fixD3). */
  reembolsos_propios_pendientes?: number;
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
    readonly opts: EngineOptions = CURRENT_OPTIONS,
  ) {
    // dict comprehension de Python: ante claves repetidas gana la última.
    this.settlementsByKey = new Map(data.settlements.map((s) => [this.settleKey(s.accountId, s.cardId, s.chargeMonth), s]));
  }

  /** Clave de un cargo de tarjeta: cuenta y mes (app vieja) o tarjeta y mes (C). */
  private settleKey(accountId: string | null, cardId: string | null | undefined, chargeMonth: Month): string {
    return this.opts.perCardSettlement && cardId ? `card:${cardId}|${chargeMonth}` : `${accountId}|${chargeMonth}`;
  }

  private memo<T>(key: string, fn: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as T;
  }

  // ----- lookups

  settledMonth(e: EExpense): Month | null {
    const st = this.settlementsByKey.get(this.settleKey(e.accountId, e.cardId, chargeMonth(e)));
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
      const key = this.settleKey(e.accountId, e.cardId, chargeMonth(e));
      let g = groups.get(key);
      if (!g) {
        g = { account_id: e.accountId, mes_cargo: chargeMonth(e), total: 0, items: [], settlement: this.settlementsByKey.get(key) ?? null };
        if (this.opts.perCardSettlement) g.card_id = e.cardId ?? null;
        groups.set(key, g);
      }
      g.total += e.amount ?? 0;
      g.items.push(e);
    }
    return [...groups.values()].sort((a, b) => cmp(a.mes_cargo, b.mes_cargo) || cmp(a.account_id ?? "", b.account_id ?? "") || cmp(a.card_id ?? "", b.card_id ?? ""));
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
      const lines: DeductionLine[] = deductionsForMonth(salary, month).filter((d) => d.name).map((d) => {
        const v = (base + atrasos + (d.appliesToExtras ? overtime : 0)) * (d.rate ?? 0);
        return { name: d.name as string, rate: d.rate ?? 0, amount: this.opts.cents ? roundHalfUp(v) : v }; // cada deducción, al céntimo
      });
      this.cache.set(`sdl|${salaryId}|${month}`, lines);
      const deducciones = pySum(lines.map((l) => l.amount));
      return { base, atrasos, horas_extra: overtime, deducciones, neto: base + atrasos + overtime - deducciones };
    });
  }

  /** Deducciones del mes, una a una (las mismas que suma salaryBreakdown). */
  salaryDeductionLines(salaryId: string, month: Month): DeductionLine[] {
    this.salaryBreakdown(salaryId, month);
    return (this.cache.get(`sdl|${salaryId}|${month}`) as DeductionLine[] | undefined) ?? [];
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
          id: fe.id, name: fe.name, isOwn: fixedIsOwnForMonth(fe, month),
          monto: fixedAmountForMonth(fe, month),
          account_id: fixedAccountForMonth(fe, month),
          estado: inst ? inst.status : "impagado",
          monto_pagado: inst ? inst.amount : null,
        });
      }
      return result;
    });
  }

  /**
   * Gastos fijos que cuentan dentro de un budget, por categoría, en una cuenta y mes. Importe
   * pagado si se pagó; si no, el previsto. Solo cuentan en el budget de su misma cuenta.
   */
  fixedInBudget(month: Month, accountId: string): Map<string, number> {
    return this.memo(`fib|${month}|${accountId}`, () => {
      const out = new Map<string, number>();
      const byId = new Map(this.data.fixedExpenses.map((f) => [f.id, f]));
      for (const fe of this.fixedExpensesForMonth(month)) {
        const cat = byId.get(fe.id)?.budgetCategoryId;
        if (!cat || fe.account_id !== accountId) continue;
        out.set(cat, (out.get(cat) ?? 0) + (fe.monto_pagado !== null ? fe.monto_pagado : fe.monto));
      }
      return out;
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

  /**
   * Reembolsos de gastos propios pendientes por cuenta, en el mes `month`.
   * Sin fixD3: la regla vieja (propioExpensesByAccount).
   * Con fixD3 (decisión D3 + A1):
   *   debido(cuenta, mes) = gastos propios de esa cuenta en ese mes; en meses cerrados solo si
   *     se marcaron pagados (si no se pagó, no hay nada que reembolsar); en el actual y futuros,
   *     el importe previsto (o el pagado, si ya se marcó);
   *   reembolsado(cuenta, mes) = transferencias de reembolso de la principal a esa cuenta;
   *   pendiente en un mes cerrado o en el actual = lo debido acumulado − lo reembolsado acumulado
   *     (no desaparece al cerrar el mes);
   *   pendiente en un mes futuro = lo de ese mes (se asume que se reembolsa cada mes).
   * Un saldo negativo (reembolsaste de más) compensa meses siguientes, pero nunca suma.
   */
  ownExpensesPending(month: Month, mainAccountId: string): Map<string, number> {
    if (!this.opts.fixD3) return this.propioExpensesByAccount(month, mainAccountId);
    return this.memo(`own|${month}|${mainAccountId}`, () => {
      const out = new Map<string, number>();
      if (month > this.currentMonth) {
        for (const [acc, owed] of this.ownOwed(month, mainAccountId)) {
          const left = owed - (this.ownRefunds(month, mainAccountId).get(acc) ?? 0);
          if (left > 0) out.set(acc, left);
        }
        return out;
      }
      for (const [acc, bal] of this.ownBalance(month, mainAccountId)) if (bal > 0) out.set(acc, bal);
      return out;
    });
  }

  /**
   * Reembolsos previstos en el saldo proyectado (decisión del 17-oct-2026, coherente con D3):
   * en el mes actual se asume reembolsado todo lo pendiente y en cada mes futuro lo de ese mes;
   * la principal lo paga (−) y la cuenta del gasto propio lo recibe (+). Solo con fixD3.
   */
  private ownRefundAdjustment(accountId: string, month: Month): number {
    if (!this.opts.fixD3 || month < this.currentMonth) return 0;
    const main = this.data.accounts.find((a) => a.isMain)?.id;
    if (!main) return 0;
    const pending = this.ownExpensesPending(month, main);
    if (accountId === main) return -pySum(pending.values());
    return pending.get(accountId) ?? 0;
  }

  /** Lo debido por gastos propios en `month`, por cuenta (fixD3). */
  ownOwed(month: Month, mainAccountId: string): Map<string, number> {
    return this.memo(`owed|${month}|${mainAccountId}`, () => {
      const out = new Map<string, number>();
      for (const fe of this.fixedExpensesForMonth(month)) {
        const acc = fe.account_id;
        if (!fe.isOwn || !acc || acc === mainAccountId) continue;
        let amount: number;
        if (month < this.currentMonth) {
          if (fe.estado !== "pagado") continue;
          amount = fe.monto_pagado !== null ? fe.monto_pagado : fe.monto;
        } else {
          amount = fe.estado === "pagado" && fe.monto_pagado !== null ? fe.monto_pagado : fe.monto;
        }
        out.set(acc, (out.get(acc) ?? 0) + amount);
      }
      return out;
    });
  }

  /** Reembolsos hechos desde la principal en `month`, por cuenta (fixD3). */
  ownRefunds(month: Month, mainAccountId: string): Map<string, number> {
    return this.memo(`refunds|${month}|${mainAccountId}`, () => {
      const out = new Map<string, number>();
      for (const t of this.data.transfers) {
        if (!t.isOwnRefund || t.from !== mainAccountId || !t.to || monthOf(t.date) !== month) continue;
        out.set(t.to, (out.get(t.to) ?? 0) + t.amount);
      }
      return out;
    });
  }

  /** Pendiente acumulado al final de `month` (meses cerrados y el actual), desde el inicio de gestión. */
  private ownBalance(month: Month, mainAccountId: string): Map<string, number> {
    return this.memo(`ownbal|${month}|${mainAccountId}`, () => {
      // Antes de ownExpensesFrom los reembolsos se hacían fuera de la app: se dan por saldados.
      const from = this.data.settings?.ownExpensesFrom;
      const start = from && from > this.minManagedMonth ? from : this.minManagedMonth;
      const prev = month > start ? this.ownBalance(addMonths(month, -1), mainAccountId) : new Map<string, number>();
      const out = new Map(prev);
      if (month < start) return out;
      for (const [acc, v] of this.ownOwed(month, mainAccountId)) out.set(acc, (out.get(acc) ?? 0) + v);
      for (const [acc, v] of this.ownRefunds(month, mainAccountId)) out.set(acc, (out.get(acc) ?? 0) - v);
      return out;
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
      const fib = new Map(this.fixedInBudget(month, accountId));

      let budgetImpact = 0;
      const details: BudgetDetail[] = [];
      for (const b of budgets) {
        const spent = raw.get(b.categoryId as string) ?? 0;
        const amount = budgetAmountForMonth(b, month);
        // Un fijo que cuenta en el budget ya está en fixedTotal: aquí solo se reserva lo que falta.
        // Si hubiera dos budgets de la misma categoría, el fijo cuenta solo en el primero.
        const fx = fib.get(b.categoryId as string) ?? 0;
        fib.delete(b.categoryId as string);
        const effective = pyMax(spent, 0) + fx;
        budgetImpact += pyMax(amount, effective) - fx;
        details.push({
          budget_id: b.id, categoria_id: b.categoryId, presupuesto: amount, real_spent: spent,
          available: amount - effective, absorbed: 0, ...(fx ? { fixed_in_budget: fx } : {}),
        });
      }
      const budgetCats = new Set(budgets.map((b) => b.categoryId));
      const nonBudgeted = pySum([...raw].filter(([cat]) => !budgetCats.has(cat)).map(([, v]) => v));
      const creditCarried = this.creditDebtCarriedInto(accountId, month);

      const pre = income + remainingFromPrevious - fixedTotal - budgetImpact - nonBudgeted - transfersOut - creditCarried;
      const resultado = absorbDeficit(pre, details, true, this.opts.cents);
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
        const propios = pySum(this.ownExpensesPending(m, mainAccountId).values());
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
        if (fe && inst.status === "pagado" && (inst.month ?? "") <= target && fixedAccountForMonth(fe, inst.month) === accountId
            && (!this.opts.fixB6 || active(fe, inst.month))) {
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
      if (this.opts.fixB1 && target > this.currentMonth) {
        // B1: se parte del saldo proyectado del mes anterior y se aplica el proyectado de este mes
        // (sueldos, fijos, budgets, gastos y transferencias), con absorción de déficit como en el arrastre.
        const prev = this.projectedBalance(accountId, addMonths(target, -1)).resultado;
        const pr = this.monthProjectedResult(accountId, target, prev);
        return { resultado: pr.resultado + this.ownRefundAdjustment(accountId, target), budget_details: pr.budget_details };
      }
      const real = this.realBalance(accountId, target);
      const fixedPending = pySum(
        this.fixedExpensesForMonth(target).filter((fe) => fe.account_id === accountId && fe.estado === "impagado").map((fe) => fe.monto),
      );
      const raw = this.rawCategoryExpenses(target, accountId);
      const fib = new Map(this.fixedInBudget(target, accountId));
      const details: BudgetDetail[] = [];
      let pendingBudget = 0;
      for (const b of this.activeBudgets(target)) {
        if (b.accountId !== accountId) continue;
        const spent = raw.get(b.categoryId as string) ?? 0;
        const fx = fib.get(b.categoryId as string) ?? 0;
        fib.delete(b.categoryId as string);
        const effective = pyMax(spent, 0) + fx;
        const amount = budgetAmountForMonth(b, target);
        details.push({ budget_id: b.id, categoria_id: b.categoryId, presupuesto: amount, real_spent: spent, available: amount - effective,
          ...(fx ? { fixed_in_budget: fx } : {}) });
        if (effective < amount) pendingBudget += amount - effective;
      }
      const creditPending = this.creditOutstanding(accountId, target, true);
      const resultado = absorbDeficit(real - fixedPending - pendingBudget - creditPending, details, false, this.opts.cents)
        + this.ownRefundAdjustment(accountId, target);
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
        for (const [acc, amt] of this.ownExpensesPending(month, main.id)) {
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
        presupuestos: pySum(this.activeBudgets(month).map((b) => budgetAmountForMonth(b, month))),
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
        // A1: en meses abiertos el proyectado mostrado ya descuenta los reembolsos propios
        // pendientes, así que es exactamente lo que se arrastra al mes siguiente.
        const own = this.opts.fixD3 && month >= this.currentMonth ? pySum(this.ownExpensesPending(month, main.id).values()) : 0;
        if (this.opts.fixD3 && month >= this.currentMonth) summary.reembolsos_propios_pendientes = own;
        Object.assign(summary, {
          remaining_from_previous_month: carry,
          resultado_real: this.monthRealResult(main.id, month) + carry,
          resultado_proyectado: proj.resultado - own,
          resultado_proyectado_pre_absorcion: proj.resultado_pre_absorcion - own,
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
