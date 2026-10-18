/**
 * Búsqueda en Movimientos: por texto (concepto, categoría, cuenta o tarjeta), categoría,
 * cuenta y fechas (un mes o un rango). Función pura para poder probarla sin la pantalla.
 */
import { monthOf, type Month } from "@salary/engine";

type Raw = Record<string, unknown>;
export const NO_CATEGORY = "__none__";

export interface MovFilter {
  text: string;
  categoryId: string;      // "" = todas; NO_CATEGORY = sin categoría
  accountId: string;       // "" = todas; cuenta de origen o de destino
  month?: Month;           // modo mes
  from?: string;           // modo rango (YYYY-MM-DD, incluidos); vacío = sin límite
  to?: string;
}

export interface Names { accounts: Record<string, Raw>; categories: Record<string, Raw>; cards: Record<string, Raw> }

const norm = (s: string) => s.toLocaleLowerCase("es").normalize("NFD").replace(/\p{M}/gu, "");

export function matches(m: Raw, f: MovFilter, names: Names): boolean {
  const date = String(m.date ?? "");
  if (f.month !== undefined) { if (monthOf(date) !== f.month) return false; }
  else {
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
  }
  if (f.categoryId) {
    if (f.categoryId === NO_CATEGORY ? m.type !== "expense" || !!m.categoryId : m.categoryId !== f.categoryId) return false;
  }
  if (f.accountId && m.accountId !== f.accountId && m.toAccountId !== f.accountId) return false;
  const t = norm(f.text.trim());
  if (!t) return true;
  const card = (m.card as { cardId?: string } | undefined)?.cardId;
  const hay = [
    m.description, m.categoryId && names.categories[m.categoryId as string]?.name,
    names.accounts[m.accountId as string]?.name, m.toAccountId && names.accounts[m.toAccountId as string]?.name,
    card && names.cards[card]?.name,
  ].filter(Boolean).map((x) => norm(String(x)));
  return hay.some((h) => h.includes(t));
}

export const isFiltering = (f: MovFilter) => !!(f.text.trim() || f.categoryId || f.accountId || f.month === undefined);
