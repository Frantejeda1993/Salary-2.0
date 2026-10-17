/**
 * Primeros pasos de un usuario nuevo: cuentas (y cuál es la principal), sueldo con sus
 * deducciones en %, gastos fijos y tarjeta de crédito. Todo opcional salvo una cuenta.
 */
import { useMemo, useState } from "react";
import { writeBatch } from "firebase/firestore";
import { currentMonthInTimeZone } from "@salary/engine";
import { useAuth } from "../auth";
import { db } from "../firebase";
import AmountInput from "../components/AmountInput";
import { parseAmount } from "../lib/money";
import { SPAIN_DEDUCTIONS, buildOnboarding, validate, type OnboardingDraft } from "../lib/onboarding";
import { userDoc, userItem } from "../lib/paths";

let k = 0;
const key = () => `k${++k}`;
const STEPS = ["Cuentas", "Sueldo", "Gastos fijos", "Tarjeta", "Listo"] as const;

interface AccRow { key: string; name: string; bankName: string; balance: string }
interface DedRow { name: string; percent: string; appliesToExtras: boolean }
interface FixRow { key: string; name: string; amount: string; accountKey: string }

const pct = (n: number) => String(n).replace(".", ",");
const monthName = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });

export default function Onboarding() {
  const { user, signOut } = useAuth();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  const currentMonth = currentMonthInTimeZone(timezone);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [accounts, setAccounts] = useState<AccRow[]>([{ key: key(), name: "", bankName: "", balance: "" }]);
  const [mainKey, setMainKey] = useState(accounts[0].key);
  const [hasSalary, setHasSalary] = useState(true);
  const [salaryName, setSalaryName] = useState("");
  const [gross, setGross] = useState("");
  const [salaryAcc, setSalaryAcc] = useState<string>("");
  const [deds, setDeds] = useState<DedRow[]>(SPAIN_DEDUCTIONS.map((d) => ({ ...d, percent: pct(d.percent) })));
  const [fixed, setFixed] = useState<FixRow[]>([]);
  const [hasCard, setHasCard] = useState(false);
  const [card, setCard] = useState({ name: "", accountKey: "", natural: true, cutoff: "", reserve: "purchase" as "purchase" | "charge" });

  const named = accounts.filter((a) => a.name.trim());
  const accountOptions = named.map((a) => ({ key: a.key, label: a.name }));
  const firstKey = named.find((a) => a.key === mainKey)?.key ?? named[0]?.key ?? "";

  const draft: OnboardingDraft = useMemo(() => ({
    displayName: user?.displayName ?? "",
    timezone,
    currentMonth,
    accounts: accounts.map((a) => ({ key: a.key, name: a.name, bankName: a.bankName, initialBalance: parseAmount(a.balance) ?? 0 })),
    mainAccountKey: mainKey,
    salary: hasSalary ? {
      name: salaryName, grossMonthly: parseAmount(gross) ?? 0, accountKey: salaryAcc || firstKey,
      deductions: deds.map((d) => ({ name: d.name, percent: d.percent.trim() === "" ? 0 : (parseAmount(d.percent) ?? -1), appliesToExtras: d.appliesToExtras })),
    } : null,
    fixed: fixed.map((f) => ({ name: f.name, amount: parseAmount(f.amount) ?? 0, accountKey: f.accountKey || firstKey })),
    card: hasCard ? {
      name: card.name, accountKey: card.accountKey || firstKey,
      cutoffDay: card.natural ? null : Number(card.cutoff) || 0, defaultReserveIn: card.reserve,
    } : null,
  }), [user, timezone, currentMonth, accounts, mainKey, hasSalary, salaryName, gross, salaryAcc, deds, fixed, hasCard, card, firstKey]);

  const allErrors = validate(draft);
  const stepErrors = [
    allErrors.filter((e) => /cuenta( principal)?\.$|Añade al menos/.test(e)),
    allErrors.filter((e) => /sueldo|deducciones|cobras/i.test(e)),
    allErrors.filter((e) => /gasto fijo/.test(e)),
    allErrors.filter((e) => /tarjeta|corte/i.test(e)),
    allErrors,
  ][step];

  async function save() {
    setSaving(true);
    setError("");
    try {
      const writes = buildOnboarding(draft, () => userItem(user!.uid, "accounts").id);
      const batch = writeBatch(db);
      for (const w of writes) {
        const ref = w.collection === "profile" ? userDoc(user!.uid) : userItem(user!.uid, w.collection, w.id);
        batch.set(ref, w.data, { merge: w.collection === "profile" });
      }
      await batch.commit();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="onboarding">
      <header className="ob-head">
        <p className="eyebrow">Primeros pasos · {step + 1} de {STEPS.length}</p>
        <div className="steps" aria-hidden>{STEPS.map((s, i) => <span key={s} className={i <= step ? "on" : ""} />)}</div>
        <h1 className="title-lg">{STEPS[step]}</h1>
      </header>

      {step === 0 && (
        <section className="card">
          <p className="muted">Las cuentas donde cobras y desde las que pagas. La <strong>principal</strong> es la que usa la app para el resultado del mes: normalmente, donde entra el sueldo.</p>
          {accounts.map((a, i) => (
            <div className="row-card" key={a.key}>
              <label className="field"><span>Nombre</span>
                <input value={a.name} placeholder={i === 0 ? "Cuenta nómina" : "Ahorro"} onChange={(e) => setAccounts(accounts.map((x) => x.key === a.key ? { ...x, name: e.target.value } : x))} /></label>
              <label className="field"><span>Banco <em>(opcional)</em></span>
                <input value={a.bankName} onChange={(e) => setAccounts(accounts.map((x) => x.key === a.key ? { ...x, bankName: e.target.value } : x))} /></label>
              <label className="field"><span>Saldo el día 1 de {monthName(currentMonth)}</span>
                <AmountInput ariaLabel="Saldo inicial" value={a.balance} onChange={(v) => setAccounts(accounts.map((x) => x.key === a.key ? { ...x, balance: v } : x))} /></label>
              <label className="check"><input type="radio" name="main" checked={mainKey === a.key} onChange={() => setMainKey(a.key)} /> Cuenta principal</label>
              {accounts.length > 1 && <button className="link danger" onClick={() => setAccounts(accounts.filter((x) => x.key !== a.key))}>Quitar</button>}
            </div>
          ))}
          <button className="btn ghost" onClick={() => setAccounts([...accounts, { key: key(), name: "", bankName: "", balance: "" }])}>+ Otra cuenta</button>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <label className="check"><input type="checkbox" checked={hasSalary} onChange={(e) => setHasSalary(e.target.checked)} /> Cobro una nómina</label>
          {hasSalary && <>
            <label className="field"><span>Empresa o nombre</span><input value={salaryName} onChange={(e) => setSalaryName(e.target.value)} /></label>
            <label className="field"><span>Bruto mensual</span><AmountInput ariaLabel="Bruto mensual" value={gross} onChange={setGross} /></label>
            <label className="field"><span>Se cobra en</span>
              <select value={salaryAcc || firstKey} onChange={(e) => setSalaryAcc(e.target.value)}>
                {accountOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select></label>
            <h2 className="title-sm">Deducciones</h2>
            <p className="muted small">Valores orientativos de un contrato indefinido en España. Compáralos con tu nómina; el IRPF es el tuyo.</p>
            <div className="deductions">
              {deds.map((d, i) => (
                <div className="ded" key={i}>
                  <input className="ded-name" aria-label="Nombre de la deducción" value={d.name} onChange={(e) => setDeds(deds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <AmountInput ariaLabel={`${d.name} en %`} suffix="%" placeholder="0" value={d.percent} onChange={(v) => setDeds(deds.map((x, j) => j === i ? { ...x, percent: v } : x))} />
                </div>
              ))}
              <button className="link" onClick={() => setDeds([...deds, { name: "", percent: "", appliesToExtras: true }])}>+ Otra deducción</button>
            </div>
          </>}
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <p className="muted">Lo que pagas cada mes casi igual: alquiler, seguros, suscripciones… Puedes añadir más después.</p>
          {fixed.map((f) => (
            <div className="row-card" key={f.key}>
              <label className="field"><span>Concepto</span><input value={f.name} onChange={(e) => setFixed(fixed.map((x) => x.key === f.key ? { ...x, name: e.target.value } : x))} /></label>
              <label className="field"><span>Importe al mes</span><AmountInput ariaLabel="Importe" value={f.amount} onChange={(v) => setFixed(fixed.map((x) => x.key === f.key ? { ...x, amount: v } : x))} /></label>
              <label className="field"><span>Se paga desde</span>
                <select value={f.accountKey || firstKey} onChange={(e) => setFixed(fixed.map((x) => x.key === f.key ? { ...x, accountKey: e.target.value } : x))}>
                  {accountOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select></label>
              <button className="link danger" onClick={() => setFixed(fixed.filter((x) => x.key !== f.key))}>Quitar</button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => setFixed([...fixed, { key: key(), name: "", amount: "", accountKey: "" }])}>+ Gasto fijo</button>
        </section>
      )}

      {step === 3 && (
        <section className="card">
          <label className="check"><input type="checkbox" checked={hasCard} onChange={(e) => setHasCard(e.target.checked)} /> Uso tarjeta de crédito</label>
          {hasCard && <>
            <label className="field"><span>Nombre</span><input value={card.name} placeholder="Visa" onChange={(e) => setCard({ ...card, name: e.target.value })} /></label>
            <label className="field"><span>Se paga desde</span>
              <select value={card.accountKey || firstKey} onChange={(e) => setCard({ ...card, accountKey: e.target.value })}>
                {accountOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select></label>
            <fieldset className="choice">
              <legend>¿Qué compras se cobran cada mes?</legend>
              <label className="check"><input type="radio" checked={card.natural} onChange={() => setCard({ ...card, natural: true })} /> Las del mes anterior completo (mes natural)</label>
              <label className="check"><input type="radio" checked={!card.natural} onChange={() => setCard({ ...card, natural: false })} /> Tiene día de corte:
                <input className="tiny" inputMode="numeric" disabled={card.natural} value={card.cutoff} placeholder="25" onChange={(e) => setCard({ ...card, cutoff: e.target.value })} /></label>
            </fieldset>
            <fieldset className="choice">
              <legend>¿Cuándo descuenta una compra de tu mes?</legend>
              <label className="check"><input type="radio" checked={card.reserve === "purchase"} onChange={() => setCard({ ...card, reserve: "purchase" })} /> En el mes en que compro</label>
              <label className="check"><input type="radio" checked={card.reserve === "charge"} onChange={() => setCard({ ...card, reserve: "charge" })} /> En el mes en que me la cobran (la pago con ese sueldo)</label>
            </fieldset>
            <p className="muted small">Es solo el valor por defecto: cada compra se puede cambiar.</p>
          </>}
        </section>
      )}

      {step === 4 && (
        <section className="card">
          <ul className="summary-list">
            <li><strong>{named.length}</strong> cuenta(s) · principal: <strong>{named.find((a) => a.key === firstKey)?.name ?? "—"}</strong></li>
            <li>{draft.salary ? <>Sueldo <strong>{draft.salary.name || "—"}</strong></> : "Sin nómina"}</li>
            <li><strong>{fixed.length}</strong> gasto(s) fijo(s)</li>
            <li>{draft.card ? <>Tarjeta <strong>{draft.card.name}</strong>, {draft.card.cutoffDay ? `corte el día ${draft.card.cutoffDay}` : "mes natural"}</> : "Sin tarjeta"}</li>
          </ul>
          <p className="muted small">La app empieza a contar en {monthName(currentMonth)}. Zona horaria: {timezone}.</p>
        </section>
      )}

      {stepErrors.length > 0 && step > 0 && <ul className="errors">{stepErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {step === 0 && stepErrors.length > 0 && named.length > 0 && <ul className="errors">{stepErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {error && <p className="error">{error}</p>}

      <footer className="ob-actions">
        {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>Atrás</button> : <button className="btn ghost" onClick={signOut}>Salir</button>}
        {step < STEPS.length - 1
          ? <button className="btn primary" disabled={stepErrors.length > 0} onClick={() => { if (step === 0 && !named.some((a) => a.key === mainKey)) setMainKey(firstKey); setStep(step + 1); }}>Siguiente</button>
          : <button className="btn primary" disabled={saving || allErrors.length > 0} onClick={save}>{saving ? "Guardando…" : "Empezar"}</button>}
      </footer>
    </div>
  );
}
