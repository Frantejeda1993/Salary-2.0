/** Meses como string 'YYYY-MM' y fechas como 'YYYY-MM-DD'. Sin objetos Date: sin zonas horarias. */

export type Month = string;
export type IsoDate = string;

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7);
}

export function addMonths(month: Month, n: number): Month {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** utils/date_utils.is_active_in_month: solo cuentan año y mes, no el día. */
export function isActiveInMonth(start: IsoDate | null | undefined, end: IsoDate | null | undefined, month: Month): boolean {
  if (!start) return false;
  if (monthOf(start) > month) return false;
  if (end == null || end === "") return true;
  return monthOf(end) >= month;
}

export function monthRange(first: Month, last: Month): Month[] {
  const out: Month[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * D5: "mes actual" según la zona horaria del usuario (por defecto Europe/Madrid), no la del
 * servidor. La app vieja usaba el reloj del servidor en UTC: entre las 00:00 y las 02:00 del
 * día 1 en Madrid creía que seguía el mes anterior. El motor nunca llama a esto por su cuenta:
 * la app calcula el mes y se lo pasa.
 */
export function currentMonthInTimeZone(timeZone = "Europe/Madrid", now: Date = new Date()): Month {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}
