/**
 * Cambios en lo que se repite cada mes (nómina, gastos fijos, budgets, préstamos), como
 * funciones puras: devuelven el documento nuevo y la app solo lo escribe. Así se prueban
 * sin Firebase y ninguna pantalla puede reescribir el pasado sin querer.
 *
 * Regla común: un cambio de importe o de cuenta nunca modifica el documento base; se añade
 * una revisión «desde el mes X», como en la app vieja. Los meses anteriores no cambian.
 */
import { addMonths, type Month } from "@salary/engine";

export type Raw = Record<string, unknown>;
type Rev = { from: Month } & Raw;

/** Añade una revisión desde `from`. Si ya hay una ese mes, se fusionan (gana lo nuevo). Ordenadas por mes. */
export function withRevision<T extends Rev>(revisions: T[] | undefined, rev: T): T[] {
  const list = [...(revisions ?? [])];
  const i = list.findIndex((r) => r.from === rev.from);
  if (i >= 0) list[i] = { ...list[i], ...rev };
  else list.push(rev);
  return list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Valor de un campo en un mes, aplicando revisiones (como el motor). */
export function valueInMonth<K extends string>(base: Raw, revisions: Rev[] | undefined, field: K, month: Month): unknown {
  let v = base[field];
  for (const r of [...(revisions ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (r.from <= month && r[field] !== undefined && r[field] !== null) v = r[field];
  }
  return v;
}

/** Último día de un mes: es la fecha de fin que se guarda («activo hasta este mes, incluido»). */
export function endOfMonth(m: Month): string {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  return `${m}-${String(d).padStart(2, "0")}`;
}

/** Meses con pago marcado después de `lastMonth`: dejarían de contar si el gasto termina ahí (B6). */
export function paymentsAfter(payments: Record<string, unknown> | undefined, lastMonth: Month): Month[] {
  return Object.keys(payments ?? {}).filter((m) => m > lastMonth).sort();
}

/** ¿Se puede borrar del todo? Solo si nunca se marcó un pago; si no, se termina (no se pierde historia). */
export const canDeleteFixed = (fe: Raw) => Object.keys((fe.payments as Raw | undefined) ?? {}).length === 0;

/**
 * Préstamo: al cambiar su importe se conserva lo ya devuelto (regla de la app vieja,
 * edit_loan_dialog): pendiente = max(nuevo importe − devuelto, 0).
 */
export function loanAfterAmountChange(oldAmount: number, oldOutstanding: number, newAmount: number) {
  const repaid = Math.max(cents(oldAmount) - cents(oldOutstanding), 0);
  const left = Math.max(cents(newAmount) - repaid, 0);
  return { status: left === 0 ? "paid" as const : "pending" as const, outstanding: left / 100 };
}

/** Préstamo tras sumar (o restar, con negativo) una devolución. El pendiente queda entre 0 y el importe. */
export function loanAfterRepayment(amount: number, outstanding: number, repaidDelta: number) {
  const left = Math.min(Math.max(cents(outstanding) - cents(repaidDelta), 0), cents(amount));
  return { status: left === 0 ? "paid" as const : "pending" as const, outstanding: left / 100 };
}

const cents = (v: number) => Math.round(v * 100);

/** Meses para elegir «desde»: unos cuantos atrás y por delante del actual. */
export function monthChoices(current: Month, back = 6, ahead = 12): Month[] {
  const out: Month[] = [];
  for (let i = -back; i <= ahead; i++) out.push(addMonths(current, i));
  return out;
}

let n = 0;
/** Id local para elementos dentro de un documento (horas extra). */
export const localId = () => `ot${Date.now().toString(36)}${(n++).toString(36)}`;

/** Cambia una revisión existente (puede cambiar de mes). Si el mes nuevo ya tenía otra, la sustituye. */
export function replaceRevision<T extends Rev>(revisions: T[] | undefined, oldFrom: Month, rev: T): T[] {
  const rest = (revisions ?? []).filter((r) => r.from !== oldFrom && r.from !== rev.from);
  return [...rest, rev].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function removeRevision<T extends Rev>(revisions: T[] | undefined, from: Month): T[] {
  return (revisions ?? []).filter((r) => r.from !== from);
}
