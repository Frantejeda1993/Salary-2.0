/**
 * Recalcular el mes de cobro de las compras con tarjeta cuando cambian el día de corte o el
 * cobro (4-nov-2026). Cada compra guarda su mes de cobro al apuntarla; si después cambia la
 * configuración de la tarjeta, las compras aún pendientes pueden quedar en el mes equivocado.
 *
 * Solo se mueven compras pendientes: ni las de un cargo ya saldado ni hacia uno saldado (el pago
 * dejaría de cuadrar), ni cargos de meses ya pasados (eso son atrasos, no cambios de corte).
 */
import type { Month } from "@salary/engine";
import { cardChargeMonth, type CardLike, type RawCol } from "./quickadd";

export interface ChargeMove { id: string; date: string; description: string; amount: number; from: Month; to: Month }
export interface ChargePlan { moves: ChargeMove[]; skippedSettled: number }

export function rechargePlan(cardId: string, card: CardLike, movements: RawCol, settlements: RawCol, currentMonth: Month): ChargePlan {
  const settled = new Set(Object.values(settlements).filter((s) => s.cardId === cardId).map((s) => String(s.chargeMonth)));
  const moves: ChargeMove[] = [];
  let skippedSettled = 0;
  for (const [id, m] of Object.entries(movements)) {
    const c = m.card as { cardId?: string; chargeMonth?: string } | undefined;
    if (m.type !== "expense" || !c || c.cardId !== cardId || !c.chargeMonth || typeof m.date !== "string") continue;
    const from = c.chargeMonth;
    const to = cardChargeMonth(card, m.date);
    if (to === from) continue;
    if (from < currentMonth || to < currentMonth) continue;
    if (settled.has(from) || settled.has(to)) { skippedSettled++; continue; }
    moves.push({ id, date: m.date, description: String(m.description ?? ""), amount: Number(m.amount), from, to });
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { moves, skippedSettled };
}

/** Resumen por cambio de mes: «noviembre → diciembre: 3 compras, 124,50 €». */
export function summarizeMoves(moves: ChargeMove[]): { from: Month; to: Month; count: number; cents: number }[] {
  const out = new Map<string, { from: Month; to: Month; count: number; cents: number }>();
  for (const m of moves) {
    const k = `${m.from}>${m.to}`;
    const g = out.get(k) ?? { from: m.from, to: m.to, count: 0, cents: 0 };
    g.count++;
    g.cents += Math.round(m.amount * 100);
    out.set(k, g);
  }
  return [...out.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
