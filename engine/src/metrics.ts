/**
 * Port de engine_metrics() de tools/migrate/salary_migrate/verify.py: produce las
 * mismas claves que los ficheros de fixtures/reference/. Solo para tests y validación.
 */
import { FinanceCore, outstandingOf } from "./core";
import type { EngineData } from "./data";
import type { Month } from "./months";
import { pySum } from "./pymath";

export type Metrics = Map<string, number>;

export function engineMetrics(data: EngineData, current: Month, minMonth: Month, months: Month[]): Metrics {
  const core = new FinanceCore(data, current, minMonth);
  const out: Metrics = new Map();
  const accounts = data.accounts.map((a) => a.id);
  const main = data.accounts.find((a) => a.isMain)?.id ?? null;
  const put = (key: string, value: unknown) => {
    if (typeof value === "number") out.set(key, value);
  };

  for (const m of months) {
    const s = core.monthSummary(m);
    for (const [k, v] of Object.entries(s)) put(`${m}|summary|${k}`, v);
    if (s.resultado_real_details) {
      put(`${m}|summary|pending_loans_total`, pySum(s.resultado_real_details.pending_loans.map(outstandingOf)));
    }
    const carry = s.remaining_from_previous_month;
    for (const a of accounts) {
      put(`${m}|${a}|real_balance`, core.realBalance(a, m));
      put(`${m}|${a}|projected_balance`, core.projectedBalance(a, m).resultado);
      put(`${m}|${a}|card_outstanding_reserved`, core.creditOutstanding(a, m, true));
      put(`${m}|${a}|card_outstanding_all`, core.creditOutstanding(a, m, false));
      put(`${m}|${a}|month_real`, core.monthRealResult(a, m));
      const pr = core.monthProjectedResult(a, m, a === main ? carry : 0);
      put(`${m}|${a}|month_projected`, pr.resultado);
      put(`${m}|${a}|month_projected_pre`, pr.resultado_pre_absorcion);
      put(`${m}|${a}|card_debt_carried`, pr.deuda_tarjeta_arrastrada);
      for (const bd of pr.budget_details) {
        for (const k of ["presupuesto", "real_spent", "available", "absorbed"] as const) {
          put(`${m}|${a}|budget|${bd.budget_id}|${k}`, bd[k]);
        }
      }
      for (const [cat, v] of core.rawCategoryExpenses(m, a)) put(`${m}|${a}|raw_category|${cat}`, v);
    }
    if (main) {
      for (const [acc, v] of core.propioExpensesByAccount(m, main)) put(`${m}|propios|${acc}`, v);
    }
    const byTipo = new Map<string, number>();
    for (const o of core.pendingObligations(m)) byTipo.set(o.tipo, (byTipo.get(o.tipo) ?? 0) + o.monto);
    for (const [tipo, v] of byTipo) put(`${m}|pending|${tipo}`, v);
    for (const sal of data.salaries) {
      const b = core.salaryBreakdown(sal.id, m);
      for (const [k, v] of Object.entries(b)) put(`${m}|salary|${sal.id}|${k}`, v);
    }
  }
  for (const a of accounts) {
    for (const [k, v] of Object.entries(core.pendingLoansImpact(a))) put(`loans|${a}|${k}`, v);
  }
  for (const g of core.creditGroups()) {
    put(`credit_group|${g.account_id}|${g.mes_cargo}|total`, g.total);
    put(`credit_group|${g.account_id}|${g.mes_cargo}|settled`, g.settlement ? 1 : 0);
  }
  return out;
}

export interface Comparison {
  compared: number;
  exact: number;
  maxAbsDiff: number;
  withinCent: boolean;
  mismatches: { key: string; expected: number | undefined; actual: number | undefined; diff?: number }[];
}

/** Igualdad exacta como objetivo; withinCent indica si al menos cuadra al céntimo. */
export function compareMetrics(expected: Record<string, number> | Metrics, actual: Metrics): Comparison {
  const exp = expected instanceof Map ? expected : new Map(Object.entries(expected));
  const keys = new Set([...exp.keys(), ...actual.keys()]);
  const res: Comparison = { compared: keys.size, exact: 0, maxAbsDiff: 0, withinCent: true, mismatches: [] };
  for (const k of [...keys].sort()) {
    const a = exp.get(k);
    const b = actual.get(k);
    if (a === undefined || b === undefined) {
      res.mismatches.push({ key: k, expected: a, actual: b });
      res.withinCent = false;
      continue;
    }
    const d = Math.abs(a - b);
    res.maxAbsDiff = Math.max(res.maxAbsDiff, d);
    if (d === 0) res.exact++;
    else {
      res.mismatches.push({ key: k, expected: a, actual: b, diff: b - a });
      if (d > 0.005) res.withinCent = false;
    }
  }
  return res;
}
