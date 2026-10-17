/**
 * Onboarding de un usuario nuevo: del formulario a los documentos de Firestore.
 * Puro (sin Firebase) para poder probarlo: devuelve la lista de escrituras.
 */
import type { Month } from "@salary/engine";

export interface AccountDraft { key: string; name: string; bankName: string; initialBalance: number }
export interface DeductionDraft { name: string; percent: number; appliesToExtras: boolean }
export interface SalaryDraft { name: string; grossMonthly: number; accountKey: string; deductions: DeductionDraft[] }
export interface FixedDraft { name: string; amount: number; accountKey: string }
export interface CardDraft { name: string; accountKey: string; cutoffDay: number | null; defaultReserveIn: "purchase" | "charge" }

export interface OnboardingDraft {
  displayName: string;
  timezone: string;
  currentMonth: Month;           // mes actual en la zona del usuario
  accounts: AccountDraft[];
  mainAccountKey: string;
  salary: SalaryDraft | null;    // null = sin nómina
  fixed: FixedDraft[];
  card: CardDraft | null;
}

export interface Write { collection: "profile" | "accounts" | "salaries" | "fixedExpenses" | "cards" | "categories"; id: string; data: Record<string, unknown> }

/**
 * Deducciones de un contrato indefinido en España (parte del trabajador). Orientativas:
 * hay que contrastarlas con la nómina. El IRPF depende de cada persona.
 */
export const SPAIN_DEDUCTIONS: DeductionDraft[] = [
  { name: "Contingencias comunes", percent: 4.7, appliesToExtras: true },
  { name: "MEI", percent: 0.15, appliesToExtras: true },
  { name: "Formación profesional", percent: 0.1, appliesToExtras: true },
  { name: "Desempleo", percent: 1.55, appliesToExtras: true },
  { name: "IRPF", percent: 0, appliesToExtras: true },
];

/** Categorías iniciales. Solo etiquetas: no afectan a ningún cálculo (D8). */
export const DEFAULT_CATEGORIES = ["Supermercado", "Restaurantes", "Transporte", "Combustible", "Ocio", "Salud", "Hogar", "Compras"];

export function validate(d: OnboardingDraft): string[] {
  const errors: string[] = [];
  const named = d.accounts.filter((a) => a.name.trim());
  if (!named.length) errors.push("Añade al menos una cuenta.");
  if (!named.some((a) => a.key === d.mainAccountKey)) errors.push("Elige cuál es tu cuenta principal.");
  const keys = new Set(named.map((a) => a.key));
  if (d.salary) {
    if (!d.salary.name.trim()) errors.push("Ponle un nombre al sueldo (por ejemplo, la empresa).");
    if (!(d.salary.grossMonthly > 0)) errors.push("El sueldo bruto mensual debe ser mayor que 0.");
    if (!keys.has(d.salary.accountKey)) errors.push("Elige en qué cuenta cobras el sueldo.");
    if (d.salary.deductions.some((x) => x.percent < 0 || x.percent > 100)) errors.push("Las deducciones van de 0 a 100 %.");
  }
  for (const f of d.fixed) {
    if (!f.name.trim() || !(f.amount > 0) || !keys.has(f.accountKey)) {
      errors.push(`Revisa el gasto fijo «${f.name || "sin nombre"}»: nombre, importe mayor que 0 y cuenta.`);
    }
  }
  if (d.card) {
    if (!d.card.name.trim() || !keys.has(d.card.accountKey)) errors.push("La tarjeta necesita nombre y la cuenta de la que se paga.");
    if (d.card.cutoffDay !== null && !(d.card.cutoffDay >= 1 && d.card.cutoffDay <= 31)) errors.push("El día de corte va de 1 a 31.");
  }
  return errors;
}

/** Escrituras del onboarding. `newId` genera ids (en la app, ids automáticos de Firestore). */
export function buildOnboarding(d: OnboardingDraft, newId: () => string): Write[] {
  const errors = validate(d);
  if (errors.length) throw new Error(errors.join(" "));
  const now = new Date().toISOString();
  const today = `${d.currentMonth}-01`;
  const writes: Write[] = [];
  const accId = new Map<string, string>();

  d.accounts.filter((a) => a.name.trim()).forEach((a, i) => {
    const id = newId();
    accId.set(a.key, id);
    writes.push({ collection: "accounts", id, data: {
      name: a.name.trim(), bankName: a.bankName.trim() || null, initialBalance: a.initialBalance || 0,
      archived: false, order: i, createdAt: now, source: "onboarding",
    } });
  });

  if (d.salary) {
    writes.push({ collection: "salaries", id: newId(), data: {
      name: d.salary.name.trim(), grossMonthly: d.salary.grossMonthly, start: today, end: null,
      accountId: accId.get(d.salary.accountKey),
      deductions: d.salary.deductions.filter((x) => x.name.trim()).map((x) => ({
        name: x.name.trim(), rate: Math.round(x.percent * 10000) / 1000000, appliesToExtras: x.appliesToExtras,
      })),
      revisions: [], overtimes: [], createdAt: now, source: "onboarding",
    } });
  }

  for (const f of d.fixed) {
    writes.push({ collection: "fixedExpenses", id: newId(), data: {
      name: f.name.trim(), amount: f.amount, start: today, end: null, accountId: accId.get(f.accountKey),
      isOwnExpense: false, revisions: [], payments: {}, createdAt: now, source: "onboarding",
    } });
  }

  if (d.card) {
    writes.push({ collection: "cards", id: newId(), data: {
      name: d.card.name.trim(), accountId: accId.get(d.card.accountKey), cutoffDay: d.card.cutoffDay,
      chargeOffsetMonths: 1, defaultReserveIn: d.card.defaultReserveIn, archived: false, createdAt: now, source: "onboarding",
    } });
  }

  DEFAULT_CATEGORIES.forEach((name, i) => {
    writes.push({ collection: "categories", id: newId(), data: { name, archived: false, order: i, createdAt: now, source: "onboarding" } });
  });

  // El perfil va el último: cuando aparece onboardingDone, todo lo demás ya está.
  writes.push({ collection: "profile", id: "", data: {
    displayName: d.displayName,
    settings: {
      // Meses <= startMonth no reciben arrastre: un usuario nuevo empieza a contar este mes (D1).
      startMonth: d.currentMonth,
      mainAccountId: accId.get(d.mainAccountKey),
      timezone: d.timezone,
      currency: "EUR",
      locale: "es-ES",
      features: { ownExpenses: false, fuel: false, loans: false },
    },
    onboardingDone: true,
    createdAt: now,
  } });
  return writes;
}
