/** Formato y lectura de importes. El motor trabaja en céntimos enteros; Firestore guarda euros. */

const fmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export const formatCents = (cents: number) => fmt.format(cents / 100);
export const formatEuros = (euros: number) => fmt.format(euros);

/**
 * Lee lo que escribe una persona: "12,50", "12.50", "1.234,56", "1,234.56", "  7 ". Devuelve
 * euros con 2 decimales o null si no es un importe. El último separador es el decimal si
 * le siguen 1 o 2 dígitos; si no, es de miles.
 */
export function parseAmount(raw: string): number | null {
  const s = (raw ?? "").replace(/\s|€/g, "");
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const last = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  let intPart = s;
  let dec = "";
  if (last >= 0 && /^\d{1,2}$/.test(s.slice(last + 1))) {
    intPart = s.slice(0, last);
    dec = s.slice(last + 1);
  }
  // Los separadores de miles solo valen en grupos de 3: "1.234.567" sí, "1,2" no.
  if (!/^-?\d+$/.test(intPart) && !/^-?\d{1,3}([.,]\d{3})+$/.test(intPart)) return null;
  intPart = intPart.replace(/[.,]/g, "");
  const v = Number(`${intPart}.${dec || "0"}`);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** "4,7" -> 0.047 (porcentaje a fracción). La app vieja confundía ambos (bug A8). */
export function parsePercent(raw: string): number | null {
  const v = parseAmount(raw);
  return v === null || v < 0 || v > 100 ? null : Math.round(v * 10000) / 1000000;
}
