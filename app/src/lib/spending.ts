/**
 * Gasto por categoría de un mes: movimientos de gasto (en su mes de imputación, como los
 * budgets) más los gastos fijos pagados (con su categoría o como «Gastos fijos»). Céntimos.
 */
export interface Slice { key: string; name: string; cents: number }

export const FIXED_KEY = "__fixed__";
export const OTHER_KEY = "__other__";
export const NONE_KEY = "";

export function spendingSlices(
  raw: Map<string, number>,
  fixedPaid: { categoryId: string | null; cents: number }[],
  names: (id: string) => string,
  maxSlices = 6,
): { slices: Slice[]; total: number; hidden: Slice[] } {
  const by = new Map<string, number>();
  for (const [cat, v] of raw) by.set(cat, (by.get(cat) ?? 0) + v);
  for (const f of fixedPaid) {
    const k = f.categoryId || FIXED_KEY;
    by.set(k, (by.get(k) ?? 0) + f.cents);
  }
  const all: Slice[] = [...by]
    .filter(([, v]) => v > 0)   // devoluciones que dejan una categoría en negativo no son gasto
    .map(([key, cents]) => ({
      key, cents,
      name: key === FIXED_KEY ? "Gastos fijos sin categoría" : key === NONE_KEY ? "Sin categoría" : names(key),
    }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, "es"));
  const total = all.reduce((t, s) => t + s.cents, 0);
  if (all.length <= maxSlices) return { slices: all, total, hidden: [] };
  const head = all.slice(0, maxSlices - 1);
  const hidden = all.slice(maxSlices - 1);
  return { slices: [...head, { key: OTHER_KEY, name: `Otras (${hidden.length})`, cents: hidden.reduce((t, s) => t + s.cents, 0) }], total, hidden };
}
