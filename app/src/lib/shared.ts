/**
 * Gastos compartidos (fase 8c): lógica pura, sin Firebase. Importes del reparto en céntimos.
 *
 * Dónde vive cada cosa (ver docs/DISENO-8C.md):
 *   pairs/{pairId}/shared/{id}        el gasto compartido (lo ven los dos)
 *   pairs/{pairId}/settlements/{id}   pagos entre vosotros para saldar (los confirma quien recibe)
 *   pairs/{pairId}/incomes/{uid_mes}  total cobrado por cada uno en un mes (para repartir por ingresos)
 *   users/{uid}/sharedLinks/{id}      lo privado de cada uno: su categoría y su movimiento
 */
import { addMonths, isActiveInMonth, monthOf, roundHalfUp, type FinanceCore, type Month, type SharedLine } from "@salary/engine";

export type SplitMode = "equal" | "percent" | "income";
export interface Split { mode: SplitMode; /** mode percent: % de cada uno (suman 100). */ percent?: Record<string, number> }

export interface SharedDoc {
  date: string; description: string; amount: number; paidBy: string; createdBy: string; split: Split;
  /** Nombre de la categoría de quien lo apuntó: la app del otro la propone si tiene una igual. */
  categoryName?: string | null;
  createdAt?: string; updatedAt?: string; updatedBy?: string;
}
export type SettlementStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export interface SettlementDoc {
  date: string; amount: number; from: string; to: string; status: SettlementStatus;
  createdAt?: string; decidedAt?: string;
}
export interface IncomeDoc { uid: string; month: Month; total: number; updatedAt?: string }
export interface SharedLink { pairId: string; categoryId: string | null; movementId: string | null }

export type WithId<T> = T & { id: string };

export const incomeDocId = (uid: string, month: Month) => `${uid}_${month}`;
const cents = (euros: number) => Math.round(euros * 100);

// ------------------------------------------------------------------------- reparto

export interface SplitResult {
  /** Céntimos de cada uno; suman el importe exacto. */
  parts: Record<string, number>;
  /** % del que no pagó, para mostrarlo. */
  shareOf: Record<string, number>;
  /** Por ingresos: puede cambiar hasta que cierre el mes (E5). */
  provisional: boolean;
  /** Por ingresos sin datos de alguno de los dos: se reparte a medias hasta que los haya. */
  missingIncome: boolean;
}

/**
 * Reparte `amountCents` entre los dos miembros. La parte de quien no pagó se redondea al céntimo
 * (mitades hacia arriba) y la diferencia va a quien pagó, para que sumen exactamente el importe.
 * `incomes`: céntimos cobrados por cada uno en el mes del gasto (solo para mode income).
 */
export function splitCents(amountCents: number, split: Split, members: [string, string], paidBy: string,
                           incomes: Record<string, number | undefined> = {}, closed = true): SplitResult {
  const [a, b] = members;
  const other = paidBy === a ? b : a;
  let otherShare = 0.5;
  let missingIncome = false;
  if (split.mode === "percent") {
    const p = split.percent?.[other];
    otherShare = typeof p === "number" && p >= 0 && p <= 100 ? p / 100 : 0.5;
  } else if (split.mode === "income") {
    const ia = incomes[a];
    const ib = incomes[b];
    if (ia === undefined || ib === undefined || ia + ib <= 0) missingIncome = true;
    else otherShare = Math.max(0, incomes[other]!) / (Math.max(0, ia) + Math.max(0, ib));
  }
  const otherPart = roundHalfUp(amountCents * otherShare);
  return {
    parts: { [paidBy]: amountCents - otherPart, [other]: otherPart },
    shareOf: { [other]: otherShare * 100, [paidBy]: (1 - otherShare) * 100 },
    provisional: split.mode === "income" && !closed,
    missingIncome,
  };
}

/** «50/50», «60/40», «por ingresos (67/33)», visto por `me`. */
export function splitLabel(r: SplitResult, split: Split, me: string, partner: string): string {
  const pct = (uid: string) => Math.round(r.shareOf[uid] ?? 0);
  const pair = `${pct(me)}/${pct(partner)}`;
  if (split.mode === "equal") return "A medias";
  if (split.mode === "percent") return pair;
  return r.missingIncome ? "Por ingresos (a medias hasta tener los datos)" : `Por ingresos (${pair})`;
}

// ------------------------------------------------------------------------- vista de un usuario

export interface SharedItemView {
  id: string; doc: SharedDoc; month: Month; amount: number;
  mine: number; theirs: number; paidByMe: boolean; split: SplitResult;
  /** Lo pagué yo y aún no dije con qué cuenta/tarjeta (o borré mi movimiento). */
  needsPayment: boolean;
  /** Mi movimiento ya no coincide con el importe compartido (lo cambió quien lo creó). */
  amountMismatch: number | null;
  link: SharedLink | null;
}

export interface SharedContext {
  me: string; partner: string; pairId: string;
  shared: WithId<SharedDoc>[]; settlements: WithId<SettlementDoc>[];
  incomes: Record<string, IncomeDoc>; links: Record<string, SharedLink>;
  /** Mis movimientos (para saber si el que enlacé existe y su importe). */
  movements: Record<string, Record<string, unknown>>;
  /** Mis categorías (para proponer la de igual nombre en lo que apunta mi pareja). */
  categories?: Record<string, Record<string, unknown>>;
  currentMonth: Month;
}

export function incomesFor(ctx: Pick<SharedContext, "incomes" | "me" | "partner">, month: Month): Record<string, number | undefined> {
  const get = (uid: string) => {
    const d = ctx.incomes[incomeDocId(uid, month)];
    return d ? cents(d.total) : undefined;
  };
  return { [ctx.me]: get(ctx.me), [ctx.partner]: get(ctx.partner) };
}

export function itemView(ctx: SharedContext, s: WithId<SharedDoc>): SharedItemView {
  const month = monthOf(s.date);
  const amount = cents(s.amount);
  const split = splitCents(amount, s.split, [ctx.me, ctx.partner], s.paidBy, incomesFor(ctx, month), month < ctx.currentMonth);
  const paidByMe = s.paidBy === ctx.me;
  const link = ctx.links[s.id] ?? null;
  const mv = link?.movementId ? ctx.movements[link.movementId] : undefined;
  const needsPayment = paidByMe && (!mv || mv.type !== "expense");
  const mvAmount = mv && mv.type === "expense" ? cents(mv.amount as number) : null;
  return {
    id: s.id, doc: s, month, amount, mine: split.parts[ctx.me], theirs: split.parts[ctx.partner], paidByMe, split,
    needsPayment, amountMismatch: paidByMe && mvAmount !== null && mvAmount !== amount ? mvAmount : null, link,
  };
}

/** Mi categoría para mi parte: la que elegí; si no elegí, la de igual nombre que la de mi pareja. */
export function myCategory(ctx: SharedContext, v: SharedItemView): string | null {
  if (v.link) return v.link.categoryId;
  return guessCategory(v.doc.categoryName, ctx.categories ?? {});
}

/** Líneas para el motor (en euros), solo de los gastos de esta pareja. */
export function engineLines(ctx: SharedContext): SharedLine[] {
  return ctx.shared.map((s) => {
    const v = itemView(ctx, s);
    return {
      id: s.id, month: v.month, paidByMe: v.paidByMe,
      movementId: v.paidByMe && !v.needsPayment ? v.link!.movementId : null,
      ownPart: v.mine / 100, otherPart: v.theirs / 100,
      categoryId: myCategory(ctx, v),
    };
  });
}

/**
 * Cuánto debo yo a mi pareja (positivo) o me debe (negativo) por un gasto o un pago confirmado.
 * Igual que la posición del motor, pero con los pagos de la lista común (los ven los dos).
 */
function deltaOf(ctx: SharedContext, v: SharedItemView): number {
  return v.paidByMe ? -v.theirs : v.mine;
}
const settleDelta = (ctx: SharedContext, s: SettlementDoc) => (s.from === ctx.me ? -cents(s.amount) : cents(s.amount));

export interface SharedMonthView {
  month: Month;
  /** Saldo al empezar el mes (+ debo, − me deben). */
  carried: number;
  items: SharedItemView[];
  settlements: WithId<SettlementDoc>[];
  /** Pagos aún sin confirmar (no cuentan). */
  pending: WithId<SettlementDoc>[];
  /** Saldo al final del mes. */
  balance: number;
  /** Mi parte y la suya del mes. */
  mineTotal: number; theirsTotal: number;
  provisional: boolean;
}

export function monthView(ctx: SharedContext, month: Month): SharedMonthView {
  const views = ctx.shared.map((s) => itemView(ctx, s));
  const confirmed = ctx.settlements.filter((s) => s.status === "confirmed");
  let carried = 0;
  for (const v of views) if (v.month < month) carried += deltaOf(ctx, v);
  for (const s of confirmed) if (monthOf(s.date) < month) carried += settleDelta(ctx, s);
  const items = views.filter((v) => v.month === month).sort((x, y) => y.doc.date.localeCompare(x.doc.date) || x.id.localeCompare(y.id));
  const settlements = confirmed.filter((s) => monthOf(s.date) === month).sort((x, y) => y.date.localeCompare(x.date));
  const balance = carried + items.reduce((t, v) => t + deltaOf(ctx, v), 0) + settlements.reduce((t, s) => t + settleDelta(ctx, s), 0);
  return {
    month, carried, items, settlements, balance,
    pending: ctx.settlements.filter((s) => s.status === "pending").sort((x, y) => y.date.localeCompare(x.date)),
    mineTotal: items.reduce((t, v) => t + v.mine, 0), theirsTotal: items.reduce((t, v) => t + v.theirs, 0),
    provisional: items.some((v) => v.split.provisional),
  };
}

/** Saldo de hoy con todo lo confirmado (para «Saldar» y para dejar de compartir). */
export function currentBalance(ctx: SharedContext): number {
  const last = ctx.shared.reduce((m, s) => (monthOf(s.date) > m ? monthOf(s.date) : m), ctx.currentMonth);
  return monthView(ctx, addMonths(last, 1)).carried;
}

/** Meses para los que hace falta publicar mi total de ingresos (los de gastos por ingresos). */
export function incomeMonthsNeeded(shared: SharedDoc[]): Month[] {
  return [...new Set(shared.filter((s) => s.split.mode === "income").map((s) => monthOf(s.date)))].sort();
}

/** Texto del saldo, visto por mí. */
export function balanceText(balance: number, partnerName: string, fmt: (c: number) => string): string {
  if (balance === 0) return "Estáis en paz";
  return balance > 0 ? `Debes ${fmt(balance)} a ${partnerName}` : `${partnerName} te debe ${fmt(-balance)}`;
}

/** Categoría mía para un gasto que apuntó mi pareja: la de igual nombre, si la tengo. */
export function guessCategory(name: string | null | undefined, categories: Record<string, Record<string, unknown>>): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  const hit = Object.entries(categories).find(([, c]) => !c.archived && String(c.name ?? "").trim().toLowerCase() === n);
  return hit ? hit[0] : null;
}

/** Valida el reparto del formulario. */
export function splitError(split: Split, members: [string, string]): string | null {
  if (split.mode !== "percent") return null;
  const vals = members.map((m) => split.percent?.[m]);
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) return "Pon un porcentaje entre 0 y 100.";
  if (Math.abs((vals[0] as number) + (vals[1] as number) - 100) > 1e-9) return "Los porcentajes tienen que sumar 100.";
  return null;
}

/**
 * Mi total cobrado en un mes, en céntimos (E5: todo lo cobrado de verdad: nóminas netas e
 * ingresos). No cuentan las devoluciones (ingresos con la categoría de un budget, regla D) ni los
 * pagos entre la pareja (son transferencias).
 */
export function myIncomeCents(core: FinanceCore, month: Month): number {
  const d = core.data;
  let total = 0;
  for (const s of d.salaries) if (isActiveInMonth(s.start, s.end, month)) total += core.salaryNet(s.id, month);
  for (const i of d.incomes) if (monthOf(i.date) === month) total += i.amount;
  for (const a of d.accounts) for (const v of core.budgetIncomeOffsets(month, a.id).values()) total -= v;
  return total;
}
