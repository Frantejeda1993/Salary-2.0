/** Formatos de fecha y listas de documentos para la interfaz. */
import type { Month } from "@salary/engine";

type Raw = Record<string, unknown>;

const at = (m: Month) => new Date(`${m}-01T12:00:00`);
/** "octubre de 2026" */
export const monthLong = (m: Month) => at(m).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
/** "octubre" */
export const monthName = (m: Month) => at(m).toLocaleDateString("es-ES", { month: "long" });
/** "oct 26" */
export const monthShort = (m: Month) => at(m).toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", "");
/** "17 oct" */
export const dayShort = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
/** "sábado, 17 de octubre" */
export const dayLong = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

/** Documentos no archivados, por `order` y después por nombre. */
export function sortedLive(col: Record<string, Raw>): [string, Raw][] {
  return Object.entries(col)
    .filter(([, d]) => !d.archived)
    .sort(([, a], [, b]) => ((a.order as number) ?? 999) - ((b.order as number) ?? 999)
      || String(a.name ?? "").localeCompare(String(b.name ?? ""), "es"));
}

export const nameOf = (col: Record<string, Raw>, id: string | null | undefined, fallback = "Cuenta borrada") =>
  (id && (col[id]?.name as string)) || fallback;

/** Días del mes y día de hoy, para el ritmo de los budgets. */
export const daysInMonth = (m: Month) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();

/** Cuentas agrupadas por banco (en el orden de la primera cuenta de cada banco). */
export function groupByBank(accounts: [string, Raw][]): { bank: string; accounts: [string, Raw][] }[] {
  const groups = new Map<string, [string, Raw][]>();
  for (const entry of accounts) {
    const bank = String(entry[1].bankName ?? "").trim() || "Sin banco";
    if (!groups.has(bank)) groups.set(bank, []);
    groups.get(bank)!.push(entry);
  }
  return [...groups].map(([bank, list]) => ({ bank, accounts: list }));
}

/**
 * Nivel de llenado de un budget, para el color de la barra:
 * verde hasta el 60 %, ámbar hasta el 85 %, naranja hasta el 100 % y rojo si se pasa.
 */
export function budgetLevel(used: number, limit: number): "ok" | "mid" | "high" | "over" {
  if (limit <= 0) return used > 0 ? "over" : "ok";
  const r = used / limit;
  return r > 1 ? "over" : r >= 0.85 ? "high" : r >= 0.6 ? "mid" : "ok";
}
