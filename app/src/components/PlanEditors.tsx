/**
 * Editores de Plan. Cada cambio que afecta a cálculos se guarda como revisión «desde el mes X»
 * (los meses anteriores no cambian). Lo que no está versionado en el modelo (deducciones,
 * «gasto propio», saldo inicial) avisa de que cambia también los meses cerrados.
 */
import { useState } from "react";
import { addMonths, type Month } from "@salary/engine";
import { useAuth } from "../auth";
import { useData } from "../data";
import { createItem, deleteItem, patchItem } from "../lib/actions";
import { monthLong, nameOf, sortedLive } from "../lib/format";
import { formatEuros, parseAmount, parsePercent } from "../lib/money";
import { SPAIN_DEDUCTIONS } from "../lib/onboarding";
import { canDeleteFixed, endOfMonth, localId, paymentsAfter, valueInMonth, withRevision } from "../lib/plan";
import { useUI } from "../ui";
import AmountInput from "./AmountInput";
import { AccountSelect, Errors, Field, MonthSelect, Section, TextInput, Warn } from "./Form";
import Sheet from "./Sheet";

type Raw = Record<string, unknown>;
type Rev = { from: Month } & Raw;
const euros = (v: unknown) => (v === undefined || v === null ? "" : Number(v).toFixed(2).replace(".", ","));
const sameCents = (a: number | null, b: unknown) => a !== null && Math.round(a * 100) === Math.round(Number(b) * 100);
const pastWarning = (from: Month, current: Month) =>
  from < current ? <Warn>Desde {monthLong(from)}: también cambia meses ya cerrados.</Warn> : null;

function useCtx() {
  const { user } = useAuth();
  const { docs, currentMonth, mainAccountId } = useData();
  const { toast } = useUI();
  return { uid: user!.uid, docs, currentMonth, mainAccountId, toast };
}

// =============================================================================== gastos fijos

export function FixedEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { uid, docs, currentMonth, mainAccountId, toast } = useCtx();
  const fe = id ? (docs.fixedExpenses[id] as Raw) : null;
  const revs = (fe?.revisions as Rev[] | undefined) ?? [];
  const curAmount = fe ? (valueInMonth(fe, revs, "amount", currentMonth) as number) : 0;
  const curAcc = fe ? (valueInMonth(fe, revs, "accountId", currentMonth) as string) : mainAccountId ?? "";

  const [name, setName] = useState((fe?.name as string) ?? "");
  const [from, setFrom] = useState<Month>(fe ? addMonths(currentMonth, 1) : currentMonth);
  // Se rellena con el importe vigente en el mes elegido (puede haber ya un cambio programado).
  const [amount, setAmount] = useState(fe ? euros(valueInMonth(fe, revs, "amount", addMonths(currentMonth, 1))) : "");
  const [acc, setAcc] = useState(curAcc);
  const curOwn = fe ? !!valueInMonth(fe, revs, "isOwnExpense", currentMonth) : false;
  const [own, setOwn] = useState(curOwn);
  const [ownFrom, setOwnFrom] = useState<Month>(addMonths(currentMonth, 1));
  const [last, setLast] = useState<Month>(fe?.end ? String(fe.end).slice(0, 7) : currentMonth);
  const [tried, setTried] = useState(false);
  const done = (text: string, undo: () => void) => { toast(text, undo); onClose(); };

  const value = parseAmount(amount);
  if (!fe) {
    const errors = [!name.trim() && "Ponle un nombre.", !(value && value > 0) && "El importe debe ser mayor que 0.", !acc && "Elige la cuenta."].filter(Boolean) as string[];
    return (
      <Sheet title="Nuevo gasto fijo" onClose={onClose}>
        <Field label="Nombre"><TextInput value={name} onChange={setName} placeholder="Alquiler" /></Field>
        <Field label="Importe cada mes"><AmountInput value={amount} onChange={setAmount} ariaLabel="Importe" /></Field>
        <Field label="Se paga desde"><AccountSelect value={acc} onChange={setAcc} /></Field>
        <Field label="Empieza en"><MonthSelect value={from} onChange={setFrom} /></Field>
        {acc && acc !== mainAccountId && (
          <label className="check"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            Es un gasto propio: lo reembolsas desde {nameOf(docs.accounts, mainAccountId)}</label>
        )}
        {pastWarning(from, currentMonth)}
        {tried && <Errors list={errors} />}
        <button className="btn primary wide save" onClick={() => {
          setTried(true);
          if (errors.length) return;
          const { undo } = createItem(uid, "fixedExpenses", {
            name: name.trim(), amount: value, start: `${from}-01`, end: null, accountId: acc,
            isOwnExpense: own && acc !== mainAccountId, revisions: [], payments: {},
          });
          done(`${name.trim()} añadido`, undo);
        }}>Añadir gasto fijo</button>
      </Sheet>
    );
  }

  const ended = !!fe.end;
  const lost = paymentsAfter(fe.payments as Raw, last);
  return (
    <Sheet title={fe.name as string} onClose={onClose}>
      <p className="muted">{formatEuros(curAmount)} al mes desde {nameOf(docs.accounts, curAcc)}.
        {ended ? ` Terminó en ${monthLong(String(fe.end).slice(0, 7))}.` : ""}</p>
      {revs.some((r) => r.from > currentMonth) && <ul className="mini-list">{revs.filter((r) => r.from > currentMonth).map((r) => (
        <li key={r.from}>Desde {monthLong(r.from)}: {[r.amount !== undefined && formatEuros(r.amount as number), r.accountId && `desde ${nameOf(docs.accounts, r.accountId as string)}`,
          r.isOwnExpense !== undefined && (r.isOwnExpense ? "gasto propio" : "deja de ser propio")].filter(Boolean).join(", ")}</li>))}</ul>}
      <Section title="Cambiar el importe" open>
        <Field label="Nuevo importe"><AmountInput value={amount} onChange={setAmount} ariaLabel="Nuevo importe" /></Field>
        <Field label="A partir de"><MonthSelect value={from} onChange={setFrom} /></Field>
        {pastWarning(from, currentMonth)}
        {value !== null && sameCents(value, valueInMonth(fe, revs, "amount", from)) && <p className="muted small">Es el importe que ya tiene en {monthLong(from)}.</p>}
        <button className="btn primary wide" disabled={!(value && value > 0) || sameCents(value, valueInMonth(fe, revs, "amount", from))} onClick={() =>
          done("Importe cambiado", patchItem(uid, "fixedExpenses", id!, { revisions: withRevision(revs, { from, amount: value }) }, fe))}>
          Guardar desde {monthLong(from)}</button>
      </Section>
      <Section title="Cambiar la cuenta">
        <Field label="Se paga desde"><AccountSelect value={acc} onChange={setAcc} include={curAcc} /></Field>
        <Field label="A partir de"><MonthSelect value={from} onChange={setFrom} /></Field>
        {pastWarning(from, currentMonth)}
        <button className="btn wide" disabled={!acc || acc === valueInMonth(fe, revs, "accountId", from)} onClick={() =>
          done("Cuenta cambiada", patchItem(uid, "fixedExpenses", id!, { revisions: withRevision(revs, { from, accountId: acc }) }, fe))}>
          Guardar desde {monthLong(from)}</button>
      </Section>
      <Section title="Gasto propio">
        <p className="muted small">Ahora {curOwn ? "es" : "no es"} un gasto propio{curOwn ? ": lo reembolsas desde la principal" : ""}.</p>
        <label className="check"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          Es un gasto propio (lo reembolsas desde la principal)</label>
        <Field label="A partir de"><MonthSelect value={ownFrom} onChange={setOwnFrom} /></Field>
        {own && valueInMonth(fe, revs, "accountId", ownFrom) === mainAccountId && <Warn>Ese mes se paga desde la cuenta principal: no hay nada que reembolsar hasta que cambie de cuenta.</Warn>}
        {pastWarning(ownFrom, currentMonth)}
        <button className="btn wide" disabled={own === !!valueInMonth(fe, revs, "isOwnExpense", ownFrom)} onClick={() =>
          done(own ? "Gasto propio desde " + monthLong(ownFrom) : "Deja de ser gasto propio en " + monthLong(ownFrom),
            patchItem(uid, "fixedExpenses", id!, { revisions: withRevision(revs, { from: ownFrom, isOwnExpense: own }) }, fe))}>
          Guardar desde {monthLong(ownFrom)}</button>
      </Section>
      <Section title="Nombre">
        <Field label="Nombre"><TextInput value={name} onChange={setName} /></Field>
        <button className="btn wide" disabled={!name.trim()} onClick={() =>
          done("Guardado", patchItem(uid, "fixedExpenses", id!, { name: name.trim() }, fe))}>Guardar</button>
      </Section>
      <Section title={ended ? "Fecha de fin" : "Terminar"}>
        <Field label="Último mes que se paga"><MonthSelect value={last} onChange={setLast} min={String(fe.start).slice(0, 7)} /></Field>
        {lost.length > 0 && <Warn>Tiene pagos marcados después ({lost.map(monthLong).join(", ")}): dejarían de contar.</Warn>}
        <button className="btn wide" onClick={() => done(`Termina en ${monthLong(last)}`, patchItem(uid, "fixedExpenses", id!, { end: endOfMonth(last) }, fe))}>
          Terminar en {monthLong(last)}</button>
        {ended && <button className="btn wide" onClick={() => done("Reanudado", patchItem(uid, "fixedExpenses", id!, { end: null }, fe))}>Quitar la fecha de fin</button>}
      </Section>
      {canDeleteFixed(fe)
        ? <button className="btn wide ghost danger-btn" onClick={() => done("Gasto fijo borrado", deleteItem(uid, "fixedExpenses", id!, fe))}>Borrar (nunca se marcó pagado)</button>
        : <p className="muted small">Tiene pagos marcados: para no perder historia, se termina en vez de borrarse.</p>}
    </Sheet>
  );
}

// =============================================================================== budgets

export function BudgetEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { uid, docs, currentMonth, mainAccountId, toast } = useCtx();
  const b = id ? (docs.budgets[id] as Raw) : null;
  const revs = (b?.revisions as Rev[] | undefined) ?? [];
  const cur = b ? (valueInMonth(b, revs, "amount", currentMonth) as number) : 0;
  const cats = sortedLive(docs.categories);
  const [cat, setCat] = useState((b?.categoryId as string) ?? cats[0]?.[0] ?? "");
  const [acc, setAcc] = useState((b?.accountId as string) ?? mainAccountId ?? "");
  const [from, setFrom] = useState<Month>(b ? addMonths(currentMonth, 1) : currentMonth);
  const [amount, setAmount] = useState(b ? euros(valueInMonth(b, revs, "amount", addMonths(currentMonth, 1))) : "");
  const [last, setLast] = useState<Month>(b?.end ? String(b.end).slice(0, 7) : currentMonth);
  const [tried, setTried] = useState(false);
  const value = parseAmount(amount);
  const done = (text: string, undo: () => void) => { toast(text, undo); onClose(); };

  if (!b) {
    const overlap = Object.values(docs.budgets).some((x) => x.categoryId === cat && x.accountId === acc && (!x.end || String(x.end).slice(0, 7) >= from));
    const errors = [!cat && "Elige una categoría (crea una en Ajustes).", !acc && "Elige la cuenta.", !(value && value > 0) && "El importe debe ser mayor que 0."].filter(Boolean) as string[];
    return (
      <Sheet title="Nuevo budget" onClose={onClose}>
        <Field label="Categoría">
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            {cats.map(([cid, c]) => <option key={cid} value={cid}>{c.name as string}</option>)}
          </select></Field>
        <Field label="Cuenta"><AccountSelect value={acc} onChange={setAcc} /></Field>
        <Field label="Importe al mes"><AmountInput value={amount} onChange={setAmount} ariaLabel="Importe" /></Field>
        <Field label="Empieza en"><MonthSelect value={from} onChange={setFrom} /></Field>
        {overlap && <Warn>Ya hay un budget de esta categoría en esta cuenta. Para cambiar su importe, edítalo en vez de crear otro.</Warn>}
        {pastWarning(from, currentMonth)}
        {tried && <Errors list={errors} />}
        <button className="btn primary wide save" onClick={() => {
          setTried(true);
          if (errors.length) return;
          const { undo } = createItem(uid, "budgets", { categoryId: cat, accountId: acc, amount: value, start: `${from}-01`, end: null, revisions: [] });
          done("Budget añadido", undo);
        }}>Añadir budget</button>
      </Sheet>
    );
  }
  const ended = !!b.end;
  return (
    <Sheet title={`Budget de ${nameOf(docs.categories, b.categoryId as string, "Sin categoría")}`} onClose={onClose}>
      <p className="muted">{formatEuros(cur)} al mes en {nameOf(docs.accounts, b.accountId as string)}.{ended ? ` Terminó en ${monthLong(String(b.end).slice(0, 7))}.` : ""}</p>
      <Section title="Cambiar el importe" open>
        <Field label="Nuevo importe"><AmountInput value={amount} onChange={setAmount} ariaLabel="Nuevo importe" /></Field>
        <Field label="A partir de"><MonthSelect value={from} onChange={setFrom} /></Field>
        {pastWarning(from, currentMonth)}
        {value !== null && sameCents(value, valueInMonth(b, revs, "amount", from)) && <p className="muted small">Es el importe que ya tiene en {monthLong(from)}.</p>}
        <button className="btn primary wide" disabled={!(value && value > 0) || sameCents(value, valueInMonth(b, revs, "amount", from))} onClick={() =>
          done("Importe cambiado", patchItem(uid, "budgets", id!, { revisions: withRevision(revs, { from, amount: value }) }, b))}>Guardar desde {monthLong(from)}</button>
      </Section>
      <Section title={ended ? "Fecha de fin" : "Terminar"}>
        <Field label="Último mes"><MonthSelect value={last} onChange={setLast} min={String(b.start).slice(0, 7)} /></Field>
        <button className="btn wide" onClick={() => done(`Termina en ${monthLong(last)}`, patchItem(uid, "budgets", id!, { end: endOfMonth(last) }, b))}>Terminar en {monthLong(last)}</button>
        {ended && <button className="btn wide" onClick={() => done("Reanudado", patchItem(uid, "budgets", id!, { end: null }, b))}>Quitar la fecha de fin</button>}
      </Section>
      {String(b.start).slice(0, 7) >= currentMonth &&
        <button className="btn wide ghost danger-btn" onClick={() => done("Budget borrado", deleteItem(uid, "budgets", id!, b))}>Borrar (aún no ha afectado a ningún mes cerrado)</button>}
    </Sheet>
  );
}

// =============================================================================== nómina

interface DedRow { name: string; percent: string; appliesToExtras: boolean }
const toRows = (deds: Raw[]): DedRow[] => deds.map((d) => ({
  name: String(d.name ?? ""), percent: String(Math.round(Number(d.rate ?? 0) * 1e6) / 1e4).replace(".", ","), appliesToExtras: !!d.appliesToExtras,
}));
function rowsToDeds(rows: DedRow[]): { deds: Raw[]; errors: string[] } {
  const errors: string[] = [];
  const deds = rows.filter((r) => r.name.trim()).map((r) => {
    const rate = r.percent.trim() === "" ? 0 : parsePercent(r.percent);
    if (rate === null) errors.push(`«${r.name}»: el porcentaje va de 0 a 100.`);
    return { name: r.name.trim(), rate: rate ?? 0, appliesToExtras: r.appliesToExtras };
  });
  return { deds, errors };
}

function Deductions({ rows, setRows }: { rows: DedRow[]; setRows: (r: DedRow[]) => void }) {
  const upd = (i: number, p: Partial<DedRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="deductions">
      {rows.map((r, i) => (
        <div className="row-card" key={i}>
          <div className="ded">
            <input className="ded-name" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label="Concepto" placeholder="Concepto" />
            <AmountInput value={r.percent} onChange={(v) => upd(i, { percent: v })} ariaLabel={`Porcentaje de ${r.name}`} suffix="%" />
          </div>
          <label className="check"><input type="checkbox" checked={r.appliesToExtras} onChange={(e) => upd(i, { appliesToExtras: e.target.checked })} />Se aplica también a las horas extra</label>
          <button className="link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button>
        </div>
      ))}
      <button className="link" onClick={() => setRows([...rows, { name: "", percent: "", appliesToExtras: true }])}>Añadir deducción</button>
    </div>
  );
}

export function SalaryEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { uid, docs, currentMonth, mainAccountId, toast } = useCtx();
  const { core } = useData();
  const s = id ? (docs.salaries[id] as Raw) : null;
  const revs = (s?.revisions as Rev[] | undefined) ?? [];
  const [name, setName] = useState((s?.name as string) ?? "");
  const [gross, setGross] = useState("");
  const [acc, setAcc] = useState((s?.accountId as string) ?? mainAccountId ?? "");
  const [from, setFrom] = useState<Month>(currentMonth);
  const [late, setLate] = useState(false);
  const [paidFrom, setPaidFrom] = useState<Month>(currentMonth);
  const dedRevs = (s?.deductionRevisions as Rev[] | undefined) ?? [];
  const curDeds = s ? ((valueInMonth(s, dedRevs, "deductions", currentMonth) as Raw[]) ?? []) : [];
  const [dedFrom, setDedFrom] = useState<Month>(addMonths(currentMonth, 1));
  const [rows, setRows] = useState<DedRow[]>(s ? toRows(curDeds) : SPAIN_DEDUCTIONS.map((d) => ({ name: d.name, percent: String(d.percent).replace(".", ","), appliesToExtras: d.appliesToExtras })));
  const [otMonth, setOtMonth] = useState<Month>(currentMonth);
  const [otGross, setOtGross] = useState("");
  const [last, setLast] = useState<Month>(s?.end ? String(s.end).slice(0, 7) : currentMonth);
  const [tried, setTried] = useState(false);
  const value = parseAmount(gross);
  const done = (text: string, undo: () => void) => { toast(text, undo); onClose(); };
  const { deds, errors: dedErrors } = rowsToDeds(rows);

  if (!s) {
    const errors = [!name.trim() && "Ponle un nombre (por ejemplo, la empresa).", !(value && value > 0) && "El bruto mensual debe ser mayor que 0.", !acc && "Elige la cuenta.", ...dedErrors].filter(Boolean) as string[];
    return (
      <Sheet title="Nueva nómina" onClose={onClose}>
        <Field label="Nombre"><TextInput value={name} onChange={setName} placeholder="Empresa" /></Field>
        <Field label="Bruto mensual"><AmountInput value={gross} onChange={setGross} ariaLabel="Bruto mensual" /></Field>
        <Field label="Se cobra en"><AccountSelect value={acc} onChange={setAcc} /></Field>
        <Field label="Primer mes"><MonthSelect value={from} onChange={setFrom} /></Field>
        <h3 className="title-sm">Deducciones</h3>
        <p className="muted small">Orientativas para España; compáralas con tu nómina. El IRPF depende de cada persona.</p>
        <Deductions rows={rows} setRows={setRows} />
        {tried && <Errors list={errors} />}
        <button className="btn primary wide save" onClick={() => {
          setTried(true);
          if (errors.length) return;
          const { undo } = createItem(uid, "salaries", { name: name.trim(), grossMonthly: value, start: `${from}-01`, end: null, accountId: acc, deductions: deds, revisions: [], overtimes: [] });
          done("Nómina añadida", undo);
        }}>Añadir nómina</button>
      </Sheet>
    );
  }

  const b = core!.salaryBreakdown(id!, currentMonth);
  const overtimes = (s.overtimes as Raw[] | undefined) ?? [];
  const otValue = parseAmount(otGross);
  return (
    <Sheet title={(s.name as string) || "Nómina"} onClose={onClose}>
      <p className="muted">Este mes: bruto {formatEuros(b.base / 100)}{b.atrasos ? `, atrasos ${formatEuros(b.atrasos / 100)}` : ""}{b.horas_extra ? `, horas extra ${formatEuros(b.horas_extra / 100)}` : ""}, neto {formatEuros(b.neto / 100)}.</p>
      <Section title="Subida o cambio de bruto" open>
        <Field label="Nuevo bruto mensual"><AmountInput value={gross} onChange={setGross} ariaLabel="Nuevo bruto" /></Field>
        <Field label="Con efecto desde"><MonthSelect value={from} onChange={setFrom} /></Field>
        <label className="check"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} />Se empezó a cobrar más tarde (con atrasos)</label>
        {late && <Field label="Primer mes que se cobró con la subida" hint="Ese mes se suman los atrasos de los meses anteriores.">
          <MonthSelect value={paidFrom} onChange={setPaidFrom} min={from} /></Field>}
        {pastWarning(late ? paidFrom : from, currentMonth)}
        <button className="btn primary wide" disabled={!(value && value > 0)} onClick={() =>
          done("Bruto cambiado", patchItem(uid, "salaries", id!, {
            revisions: withRevision(revs, { from, gross: value, ...(late && paidFrom > from ? { paidFrom } : {}) }),
          }, s))}>Guardar</button>
        {revs.length > 0 && <ul className="mini-list">{revs.map((r) => <li key={r.from}>{monthLong(r.from)}: {formatEuros(r.gross as number)}{r.paidFrom ? `, cobrado desde ${monthLong(r.paidFrom as string)}` : ""}</li>)}</ul>}
      </Section>
      <Section title="Horas extra y pagas">
        {overtimes.length > 0 && <ul className="mini-list">{[...overtimes].sort((x, y) => String(x.month).localeCompare(String(y.month))).map((o) => (
          <li key={o.id as string}>{monthLong(o.month as string)}: {formatEuros(o.gross as number)} brutos
            <button className="link danger" onClick={() => done("Quitado", patchItem(uid, "salaries", id!, { overtimes: overtimes.filter((x) => x.id !== o.id) }, s))}>Quitar</button></li>))}</ul>}
        <Field label="Mes"><MonthSelect value={otMonth} onChange={setOtMonth} /></Field>
        <Field label="Importe bruto"><AmountInput value={otGross} onChange={setOtGross} ariaLabel="Importe bruto" /></Field>
        <button className="btn wide" disabled={!(otValue && otValue > 0)} onClick={() =>
          done("Añadido", patchItem(uid, "salaries", id!, { overtimes: [...overtimes, { id: localId(), month: otMonth, gross: otValue }] }, s))}>Añadir</button>
      </Section>
      <Section title="Deducciones">
        <p className="muted small">Las de este mes. Los cambios valen a partir del mes que elijas; los anteriores no cambian.</p>
        <Deductions rows={rows} setRows={setRows} />
        <Field label="A partir de"><MonthSelect value={dedFrom} onChange={setDedFrom} /></Field>
        {pastWarning(dedFrom, currentMonth)}
        <Errors list={dedErrors} />
        <button className="btn wide" disabled={dedErrors.length > 0} onClick={() =>
          done(`Deducciones desde ${monthLong(dedFrom)}`, patchItem(uid, "salaries", id!, { deductionRevisions: withRevision(dedRevs, { from: dedFrom, deductions: deds }) }, s))}>
          Guardar desde {monthLong(dedFrom)}</button>
        {dedRevs.length > 0 && <ul className="mini-list">{dedRevs.map((r) => <li key={r.from}>Desde {monthLong(r.from)}: {(r.deductions as Raw[]).filter((x) => x.name).map((x) => `${x.name} ${String(Math.round(Number(x.rate) * 1e6) / 1e4).replace(".", ",")} %`).join(", ") || "sin deducciones"}</li>)}</ul>}
      </Section>
      <Section title="Nombre">
        <Field label="Nombre"><TextInput value={name} onChange={setName} /></Field>
        <button className="btn wide" disabled={!name.trim()} onClick={() => done("Guardado", patchItem(uid, "salaries", id!, { name: name.trim() }, s))}>Guardar</button>
      </Section>
      <Section title={s.end ? "Fecha de fin" : "Terminar"}>
        <Field label="Último mes cobrado"><MonthSelect value={last} onChange={setLast} min={String(s.start).slice(0, 7)} /></Field>
        <button className="btn wide" onClick={() => done(`Termina en ${monthLong(last)}`, patchItem(uid, "salaries", id!, { end: endOfMonth(last) }, s))}>Terminar en {monthLong(last)}</button>
        {!!s.end && <button className="btn wide" onClick={() => done("Reanudada", patchItem(uid, "salaries", id!, { end: null }, s))}>Quitar la fecha de fin</button>}
      </Section>
    </Sheet>
  );
}

// =============================================================================== tarjetas

export function CardEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { uid, docs, mainAccountId, toast } = useCtx();
  const c = id ? (docs.cards[id] as Raw) : null;
  const [name, setName] = useState((c?.name as string) ?? "");
  const [acc, setAcc] = useState((c?.accountId as string) ?? mainAccountId ?? "");
  const [natural, setNatural] = useState(!c?.cutoffDay);
  const [cutoff, setCutoff] = useState(c?.cutoffDay ? String(c.cutoffDay) : "");
  const [offset, setOffset] = useState(String(c?.chargeOffsetMonths ?? 1));
  const [reserve, setReserve] = useState<"purchase" | "charge">((c?.defaultReserveIn as "purchase" | "charge") ?? "purchase");
  const [tried, setTried] = useState(false);
  const day = Number(cutoff);
  const errors = [!name.trim() && "Ponle un nombre.", !acc && "Elige la cuenta de la que se paga.",
    !natural && !(Number.isInteger(day) && day >= 1 && day <= 31) && "El día de corte va de 1 a 31."].filter(Boolean) as string[];
  const accChanged = !!c && acc !== c.accountId;
  const data = { name: name.trim(), accountId: acc, cutoffDay: natural ? null : day, chargeOffsetMonths: Number(offset), defaultReserveIn: reserve };
  const close = (text: string, undo: () => void) => { toast(text, undo); onClose(); };
  return (
    <Sheet title={c ? (c.name as string) : "Nueva tarjeta de crédito"} onClose={onClose}>
      <Field label="Nombre"><TextInput value={name} onChange={setName} placeholder="Visa" /></Field>
      <Field label="Se paga desde"><AccountSelect value={acc} onChange={setAcc} include={c?.accountId as string} /></Field>
      {accChanged && <Warn>Las compras ya registradas siguen en {nameOf(docs.accounts, c!.accountId as string)}; solo las nuevas irán a la cuenta nueva.</Warn>}
      <fieldset className="choice"><legend>¿Cuándo se cobra?</legend>
        <label className="check"><input type="radio" checked={natural} onChange={() => setNatural(true)} />Todo lo de un mes se cobra el mes siguiente</label>
        <label className="check"><input type="radio" checked={!natural} onChange={() => setNatural(false)} />Hay día de corte
          {!natural && <input className="tiny" inputMode="numeric" value={cutoff} onChange={(e) => setCutoff(e.target.value)} aria-label="Día de corte" />}</label>
      </fieldset>
      {!natural && <Field label="El extracto se cobra" hint="Lo comprado hasta el día de corte entra en el extracto de ese mes.">
        <select className="input" value={offset} onChange={(e) => setOffset(e.target.value)}>
          <option value="0">El mismo mes del corte</option><option value="1">El mes siguiente al corte</option><option value="2">Dos meses después</option>
        </select></Field>}
      <div className="field"><span>Por defecto, descontar las compras</span>
        <div className="segmented" role="group">
          <button type="button" aria-pressed={reserve === "purchase"} onClick={() => setReserve("purchase")}>Al comprar</button>
          <button type="button" aria-pressed={reserve === "charge"} onClick={() => setReserve("charge")}>Al cobrarse</button>
        </div></div>
      {c && <p className="muted small">Los cambios de corte y cobro valen para las compras nuevas; las ya registradas mantienen su mes de cobro.</p>}
      {tried && <Errors list={errors} />}
      <button className="btn primary wide save" onClick={() => {
        setTried(true);
        if (errors.length) return;
        if (c) close("Tarjeta guardada", patchItem(uid, "cards", id!, data, c));
        else close("Tarjeta añadida", createItem(uid, "cards", { ...data, archived: false }).undo);
      }}>{c ? "Guardar" : "Añadir tarjeta"}</button>
      {c && <button className="btn wide ghost danger-btn" onClick={() => close(c.archived ? "Tarjeta recuperada" : "Tarjeta archivada", patchItem(uid, "cards", id!, { archived: !c.archived }, c))}>
        {c.archived ? "Recuperar tarjeta" : "Archivar (ya no aparece para pagar)"}</button>}
    </Sheet>
  );
}
