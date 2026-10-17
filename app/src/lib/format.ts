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
