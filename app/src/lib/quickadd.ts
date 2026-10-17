/**
 * Lógica pura del alta rápida (sin Firebase ni React) para poder probarla.
 */
import { addMonths, type Month } from "@salary/engine";

export type Raw = Record<string, unknown>;
export type RawCol = Record<string, Raw>;

export interface CardLike { accountId?: string; cutoffDay?: number | null; chargeOffsetMonths?: number; defaultReserveIn?: "purchase" | "charge" }

/**
 * Mes en que el banco cobra una compra con tarjeta de crédito (D6).
 *  - Sin día de corte: el mes de la compra + chargeOffsetMonths (por defecto 1: la regla de la app vieja).
 *  - Con día de corte N: una compra hasta el día N entra en el extracto de ese mes; después, en el
 *    del mes siguiente. Se cobra chargeOffsetMonths después del extracto.
 */
export function cardChargeMonth(card: CardLike, isoDate: string): Month {
  const month = isoDate.slice(0, 7);
  const day = Number(isoDate.slice(8, 10));
  const offset = card.chargeOffsetMonths ?? 1;
  const statement = card.cutoffDay && day > card.cutoffDay ? addMonths(month, 1) : month;
  return addMonths(statement, offset);
}

const norm = (s: string) => s.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface MerchantInfo { name: string; count: number; lastDate: string; categoryId: string | null; payWith: string }

/** «Pagar con»: una cuenta (`acc:<id>`) o una tarjeta (`card:<id>`). */
export const payWithOf = (m: Raw): string => {
  const card = m.card as { cardId?: string } | undefined;
  return card?.cardId ? `card:${card.cardId}` : `acc:${m.accountId as string}`;
};

/** Comercios usados en gastos, con su última categoría y medio de pago. Más usados primero. */
export function merchantHistory(movements: RawCol): MerchantInfo[] {
  const byKey = new Map<string, MerchantInfo>();
  const ordered = Object.values(movements)
    .filter((m) => m.type === "expense" && typeof m.description === "string" && (m.description as string).trim())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  for (const m of ordered) {
    const name = (m.description as string).trim();
    const k = norm(name);
    const prev = byKey.get(k);
    byKey.set(k, {
      name, // la grafía más reciente
      count: (prev?.count ?? 0) + 1,
      lastDate: m.date as string,
      categoryId: (m.categoryId as string | null) ?? null,
      payWith: payWithOf(m),
    });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
}

/** Sugerencias para lo tecleado: primero los que empiezan así, después los que lo contienen. */
export function suggestMerchants(history: MerchantInfo[], typed: string, limit = 4): MerchantInfo[] {
  const t = norm(typed);
  if (!t) return history.slice(0, limit);
  const starts = history.filter((h) => norm(h.name).startsWith(t));
  const contains = history.filter((h) => !norm(h.name).startsWith(t) && norm(h.name).includes(t));
  return [...starts, ...contains].filter((h) => norm(h.name) !== t).slice(0, limit);
}

export function findMerchant(history: MerchantInfo[], name: string): MerchantInfo | undefined {
  const t = norm(name);
  return t ? history.find((h) => norm(h.name) === t) : undefined;
}

/** Medio de pago del último gasto (para preseleccionarlo). */
export function lastPayWith(movements: RawCol): string | null {
  let best: Raw | null = null;
  for (const m of Object.values(movements)) {
    if (m.type !== "expense") continue;
    if (!best || String(m.date) > String(best.date)
        || (m.date === best.date && String(m.createdAt ?? "") > String(best.createdAt ?? ""))) best = m;
  }
  return best ? payWithOf(best) : null;
}

/** ¿Ya hay un gasto igual (mismo importe y comercio) ese día? Para avisar de duplicados. */
export function findDuplicate(movements: RawCol, amount: number, description: string, isoDate: string): string | null {
  const t = norm(description);
  for (const [id, m] of Object.entries(movements)) {
    if (m.type === "expense" && m.date === isoDate && Math.round(Number(m.amount) * 100) === Math.round(amount * 100)
        && norm(String(m.description ?? "")) === t) return id;
  }
  return null;
}

/** Busca una tarjeta o cuenta por nombre (atajo: `tarjeta=Visa`). Exacto, si no, contiene. */
export function matchByName(col: RawCol, name: string | null): string | null {
  if (!name) return null;
  const t = norm(name);
  const live = Object.entries(col).filter(([, d]) => !d.archived);
  const exact = live.find(([, d]) => norm(String(d.name ?? "")) === t);
  if (exact) return exact[0];
  const partial = live.filter(([, d]) => norm(String(d.name ?? "")).includes(t));
  return partial.length === 1 ? partial[0][0] : null;
}

/** Fecha de un atajo: "2026-10-17", "17/10/2026" o "17-10-2026". */
export function parseShortcutDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Hoy (YYYY-MM-DD) en la zona horaria del usuario. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
