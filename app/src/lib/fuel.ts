/**
 * Repostajes: consumo y coste a partir de lo que guarda cada gasto de combustible
 * (`fuel: { km, pricePerLiter }`, igual que la app vieja: km hechos desde el repostaje anterior
 * y precio por litro). Litros = importe / precio. No afecta a ningún cálculo de dinero.
 */
type Raw = Record<string, unknown>;

export interface FuelInfo { km: number; pricePerLiter: number }
export interface FuelFill {
  id: string; date: string; merchant: string; amount: number; km: number; price: number;
  liters: number; lPer100: number | null; eurPerKm: number | null;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("es").normalize("NFD").replace(/\p{M}/gu, "");
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Lo que sale de un repostaje. Sin precio no hay litros; sin km no hay consumo. */
export function fillFigures(amount: number, km: number, price: number) {
  const liters = price > 0 ? amount / price : 0;
  return {
    liters,
    lPer100: liters > 0 && km > 0 ? (liters / km) * 100 : null,
    eurPerKm: km > 0 ? amount / km : null,
  };
}

/**
 * ¿Es una categoría de combustible? Lo que marques manda; si nunca lo marcaste, lo es si ya
 * tiene repostajes apuntados (los que vienen de la app vieja).
 */
export function isFuelCategory(catId: string | null | undefined, categories: Record<string, Raw>, movements: Record<string, Raw>): boolean {
  if (!catId || !categories[catId]) return false;
  const flag = categories[catId].isFuel;
  if (typeof flag === "boolean") return flag;
  return Object.values(movements).some((m) => m.type === "expense" && m.categoryId === catId && isFuelInfo(m.fuel));
}

const isFuelInfo = (f: unknown): f is FuelInfo => !!f && typeof f === "object" && Number((f as FuelInfo).pricePerLiter) > 0;

/** Repostajes con precio, del más antiguo al más reciente. */
export function fuelHistory(movements: Record<string, Raw>, exclude?: string): FuelFill[] {
  const out: FuelFill[] = [];
  for (const [id, m] of Object.entries(movements)) {
    if (id === exclude || m.type !== "expense" || !isFuelInfo(m.fuel)) continue;
    const amount = Number(m.amount) || 0, km = Number(m.fuel.km) || 0, price = Number(m.fuel.pricePerLiter);
    out.push({ id, date: String(m.date), merchant: String(m.description ?? ""), amount, km, price, ...fillFigures(amount, km, price) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Precio por litro para rellenar: el último en esa gasolinera; si no, el último en cualquiera. */
export function suggestedPrice(history: FuelFill[], merchant: string): number | null {
  const t = norm(merchant);
  const same = t ? history.filter((f) => norm(f.merchant) === t) : [];
  const last = (same.length ? same : history).at(-1);
  return last ? last.price : null;
}

export interface FuelComparison {
  liters: number; lPer100: number | null; eurPerKm: number | null;
  /** Media de los últimos `n` repostajes con km (consumo y €/km) y con precio. */
  avg: { n: number; lPer100: number | null; eurPerKm: number | null; price: number | null };
  last: FuelFill | null;
}

export function compareFill(amount: number, km: number, price: number, history: FuelFill[], n = 5): FuelComparison {
  const now = fillFigures(amount, km, price);
  const withKm = history.filter((f) => f.lPer100 !== null).slice(-n);
  const recent = history.slice(-n);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    ...now,
    avg: {
      n: withKm.length,
      lPer100: mean(withKm.map((f) => f.lPer100!)),
      eurPerKm: mean(withKm.map((f) => f.eurPerKm!)),
      price: mean(recent.map((f) => f.price)),
    },
    last: history.at(-1) ?? null,
  };
}

/** Texto corto de una diferencia: «0,4 L/100 km menos», «3 céntimos más por litro». */
export function deltaText(now: number, ref: number, unit: "l100" | "eurkm" | "price"): { text: string; better: boolean } | null {
  const d = now - ref;
  if (unit === "price") {
    const c = round(Math.abs(d) * 100, 1);
    if (c < 0.5) return { text: "mismo precio por litro", better: true };
    return { text: `${String(c).replace(".", ",")} cént. ${d < 0 ? "menos" : "más"} por litro`, better: d < 0 };
  }
  if (unit === "l100") {
    const v = round(Math.abs(d), 1);
    if (v < 0.1) return { text: "consumo igual", better: true };
    return { text: `${String(v).replace(".", ",")} L/100 km ${d < 0 ? "menos" : "más"}`, better: d < 0 };
  }
  const c = round(Math.abs(d) * 100, 1);
  if (c < 0.1) return { text: "mismo coste por km", better: true };
  return { text: `${String(c).replace(".", ",")} cént./km ${d < 0 ? "menos" : "más"}`, better: d < 0 };
}

/**
 * Número de un campo de repostaje. El precio lleva hasta 3 decimales («1,539»: coma o punto
 * decimal). Los km admiten miles con punto («1.050») y decimales con coma («612,5»).
 */
export function parseFuelNumber(raw: string, kind: "price" | "km"): number | null {
  let s = raw.trim().replace(/\s|€|km|l/gi, "");
  if (!s) return null;
  if (kind === "price") s = s.replace(",", ".");
  else s = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Lee los dos campos del formulario. Los dos vacíos = sin datos de repostaje. */
export function parseFuel(kmRaw: string, priceRaw: string): FuelInfo | null | "invalid" {
  const price = priceRaw.trim() ? parseFuelNumber(priceRaw, "price") : null;
  const km = kmRaw.trim() ? parseFuelNumber(kmRaw, "km") : 0;
  if (!priceRaw.trim() && !kmRaw.trim()) return null;
  if (price === null || price <= 0 || km === null || km < 0) return "invalid";
  return { km, pricePerLiter: price };
}

/** Marcas de gasolinera habituales en España: si el comercio es nuevo, se reconoce por el nombre. */
const FUEL_BRANDS = ["repsol", "cepsa", "moeve", "shell", "bp", "galp", "petronor", "campsa", "ballenoil", "plenoil",
  "petroprix", "avia", "esso", "disa", "meroil", "q8", "gasolinera", "estacion de servicio", "e.s.", "carburante", "low cost fuel"];

/** ¿Parece una gasolinera? Palabra completa, sin mayúsculas ni tildes («Repsol Av. Madrid» sí, «Bpo» no). */
export function looksLikeFuelStation(merchant: string): boolean {
  const t = ` ${norm(merchant).replace(/[^a-z0-9.]+/g, " ")} `;
  return FUEL_BRANDS.some((b) => t.includes(` ${b} `) || (b.includes(" ") && t.includes(b)));
}

/**
 * Categoría a proponer para un comercio nuevo que parece gasolinera. `fuelCategoryIds` va
 * ordenado por uso (la del repostaje más reciente primero): se propone la primera.
 */
export function guessFuelCategory(merchant: string, fuelCategoryIds: string[]): string | null {
  return fuelCategoryIds.length > 0 && looksLikeFuelStation(merchant) ? fuelCategoryIds[0] : null;
}

/** Categorías de combustible ordenadas por su repostaje más reciente (las sin repostajes, al final). */
export function fuelCategoriesByUse(ids: string[], movements: Record<string, Raw>): string[] {
  const last = new Map<string, string>();
  for (const m of Object.values(movements)) {
    if (m.type !== "expense" || !m.categoryId || !ids.includes(m.categoryId as string)) continue;
    const d = String(m.date);
    if (d > (last.get(m.categoryId as string) ?? "")) last.set(m.categoryId as string, d);
  }
  return [...ids].sort((a, b) => (last.get(b) ?? "").localeCompare(last.get(a) ?? ""));
}
