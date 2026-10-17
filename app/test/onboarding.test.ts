import { describe, expect, it } from "vitest";
import { CURRENT_OPTIONS, FinanceCore, fromDataset, type Dataset } from "@salary/engine";
import { buildOnboarding, SPAIN_DEDUCTIONS, validate, type OnboardingDraft } from "../src/lib/onboarding";
import { parseAmount, parsePercent } from "../src/lib/money";

const draft = (over: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  displayName: "Ana",
  timezone: "Europe/Madrid",
  currentMonth: "2026-10",
  accounts: [
    { key: "a", name: "Nómina", bankName: "Banco", initialBalance: 1200 },
    { key: "b", name: "Ahorro", bankName: "", initialBalance: 5000 },
  ],
  mainAccountKey: "a",
  salary: { name: "Empresa", grossMonthly: 2500, accountKey: "a", deductions: SPAIN_DEDUCTIONS.map((d) => ({ ...d, percent: d.name === "IRPF" ? 12 : d.percent })) },
  fixed: [{ name: "Alquiler", amount: 800, accountKey: "a" }],
  card: { name: "Visa", accountKey: "a", cutoffDay: null, defaultReserveIn: "purchase" },
  ...over,
});

let n = 0;
const ids = () => `id${String(++n).padStart(3, "0")}`;

/** Aplica las escrituras como lo haría Firestore y devuelve el dataset del motor. */
function toDataset(d: OnboardingDraft): Dataset {
  const docs: Record<string, Record<string, unknown>> = {
    accounts: {}, categories: {}, salaries: {}, fixedExpenses: {}, budgets: {}, movements: {}, cards: {}, cardSettlements: {},
  };
  let profile: any = null;
  for (const w of buildOnboarding(d, ids)) {
    if (w.collection === "profile") profile = w.data;
    else (docs[w.collection] as Record<string, unknown>)[w.id] = w.data;
  }
  return { profile, docs: docs as any };
}

describe("onboarding", () => {
  it("crea cuentas, principal, sueldo, fijo, tarjeta, categorías y el perfil al final", () => {
    const writes = buildOnboarding(draft(), ids);
    expect(writes.at(-1)!.collection).toBe("profile");
    const p = writes.at(-1)!.data as any;
    const main = writes.find((w) => w.collection === "accounts" && (w.data as any).name === "Nómina")!;
    expect(p.settings.mainAccountId).toBe(main.id);
    expect(p.settings.startMonth).toBe("2026-10");
    expect(p.onboardingDone).toBe(true);
    const sal = writes.find((w) => w.collection === "salaries")!.data as any;
    expect(sal.deductions.map((x: any) => x.rate)).toEqual([0.047, 0.0015, 0.001, 0.0155, 0.12]);   // % -> fracción (A8)
    expect(writes.filter((w) => w.collection === "categories").length).toBeGreaterThan(3);
  });

  it("el motor calcula el mes de un usuario recién creado", () => {
    const ds = toDataset(draft());
    const core = new FinanceCore(fromDataset(ds, { cents: true }), "2026-10", ds.profile.settings.startMonth, CURRENT_OPTIONS);
    const net = Math.round(2500 * 100 * (1 - 0.047 - 0.0015 - 0.001 - 0.0155 - 0.12));
    const s = core.monthSummary("2026-10");
    expect(s.remaining_from_previous_month).toBe(0);                 // primer mes: sin arrastre
    expect(s.ingreso_total).toBe(net);
    expect(s.resultado_proyectado).toBe(net - 80000);                // menos el alquiler
    const mainId = ds.profile.settings.mainAccountId!;
    expect(core.realBalance(mainId, "2026-10")).toBe(120000 + net);  // saldo día 1 + sueldo; alquiler aún sin pagar
  });

  it("sin nómina ni tarjeta también vale", () => {
    expect(validate(draft({ salary: null, card: null, fixed: [] }))).toEqual([]);
  });

  it("valida lo imprescindible", () => {
    expect(validate(draft({ accounts: [] }))).toContain("Añade al menos una cuenta.");
    expect(validate(draft({ mainAccountKey: "zzz" }))).toContain("Elige cuál es tu cuenta principal.");
    expect(validate(draft({ card: { name: "V", accountKey: "a", cutoffDay: 40, defaultReserveIn: "purchase" } }))).toContain("El día de corte va de 1 a 31.");
    expect(() => buildOnboarding(draft({ accounts: [] }), ids)).toThrow();
  });
});

describe("importes", () => {
  it.each([
    ["12,50", 12.5], ["12.50", 12.5], ["1.234,56", 1234.56], ["1,234.56", 1234.56], ["1.234", 1234],
    [" 7 €", 7], ["0,1", 0.1], ["-3,2", -3.2], ["abc", null], ["", null], ["1,2,3", null], ["1.234.567,8", 1234567.8],
  ])("%s -> %s", (raw, v) => expect(parseAmount(raw as string)).toBe(v));

  it("porcentajes a fracción", () => {
    expect(parsePercent("4,7")).toBe(0.047);
    expect(parsePercent("0,15")).toBe(0.0015);
    expect(parsePercent("120")).toBeNull();
  });
});
