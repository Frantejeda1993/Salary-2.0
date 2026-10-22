/**
 * Ficha de una nómina o de un gasto fijo: el cálculo de este mes, sus cambios en el tiempo
 * (editables y borrables) y, con menos peso, las acciones raras (deducciones, terminar, borrar).
 * Cada acción guarda al momento con «Deshacer» y vuelve a la ficha.
 */
import { useState, type ReactNode } from "react";
import { addMonths, type Month } from "@salary/engine";
import { useData } from "../data";
import { deleteItem, patchItem, type Undo } from "../lib/actions";
import { monthLong, nameOf } from "../lib/format";
import { formatCents, formatEuros, parseAmount } from "../lib/money";
import {
  canDeleteFixed, endOfMonth, localId, paidSinceStart, paymentsAfter, removeRevision, replaceRevision, valueInMonth, withRevision,
} from "../lib/plan";
import AmountInput from "./AmountInput";
import { AccountSelect, CategorySelect, Errors, InBudgetChoice, Field, MonthSelect, Warn } from "./Form";
import { IconPencil } from "./Icons";
import {
  Deductions, euros, pastWarning, rowsToDeds, toRows, useCtx, type DedRow, type Raw, type Rev,
} from "./PlanEditors";
import Sheet from "./Sheet";

const pct = (rate: number) => `${String(Math.round(rate * 1e6) / 1e4).replace(".", ",")} %`;

/** Nombre con lápiz: al tocarlo se edita en el sitio. */
function EditableName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  if (!editing) {
    return (
      <div className="editable-name">
        <h3>{name}</h3>
        <button className="icon-btn" aria-label="Cambiar el nombre" onClick={() => { setV(name); setEditing(true); }}><IconPencil /></button>
      </div>
    );
  }
  return (
    <form className="editable-name editing" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSave(v.trim()); setEditing(false); } }}>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} autoFocus aria-label="Nombre" />
      <button className="btn small primary" type="submit" disabled={!v.trim()}>Guardar</button>
      <button className="btn small" type="button" onClick={() => setEditing(false)}>Cancelar</button>
    </form>
  );
}

function Calc({ title, rows, total }: { title: string; rows: [ReactNode, number, string?][]; total: [string, number] }) {
  return (
    <section className="calc" aria-label={title}>
      <h4>{title}</h4>
      {rows.map(([label, cents, cls], i) => (
        <div className={`calc-row ${cls ?? ""}`} key={i}><span>{label}</span><span>{formatCents(cents)}</span></div>
      ))}
      <div className="calc-row total"><span>{total[0]}</span><span>{formatCents(total[1])}</span></div>
    </section>
  );
}

function ChangeList({ title, onAdd, addLabel, items, empty }: {
  title: string; onAdd: () => void; addLabel: string; empty: string;
  items: { key: string; text: ReactNode; sub?: ReactNode; onEdit: () => void; onRemove: () => void }[];
}) {
  return (
    <section className="changes">
      <div className="section-head"><h4>{title}</h4><button className="link" onClick={onAdd}>{addLabel}</button></div>
      {items.length === 0 ? <p className="muted small">{empty}</p> : (
        <ul className="rows">
          {items.map((it) => (
            <li key={it.key}>
              <span className="what"><b>{it.text}</b>{it.sub && <small>{it.sub}</small>}</span>
              <span className="act"><button className="link" onClick={it.onEdit}>Editar</button><button className="link danger" onClick={it.onRemove}>Quitar</button></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return <div className="form-actions">{children}<button className="btn wide ghost" onClick={onCancel}>Volver a la ficha</button></div>;
}

// =============================================================================== nómina

type SalaryMode =
  | { kind: "view" } | { kind: "revision"; from?: Month } | { kind: "overtime"; id?: string }
  | { kind: "deductions" } | { kind: "end" };

export function SalaryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { uid, docs, currentMonth, toast } = useCtx();
  const { core } = useData();
  const [mode, setMode] = useState<SalaryMode>({ kind: "view" });
  const s = docs.salaries[id] as Raw | undefined;
  if (!s || !core) return null;
  const save = (text: string, undo: Undo) => { toast(text, undo); setMode({ kind: "view" }); };
  const patch = (text: string, p: Raw) => save(text, patchItem(uid, "salaries", id, p, s));
  const revs = ((s.revisions as Rev[] | undefined) ?? []).slice().sort((a, b) => (a.from < b.from ? 1 : -1));
  const overtimes = ((s.overtimes as Raw[] | undefined) ?? []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const name = (s.name as string) || "Nómina";
  const back = () => setMode({ kind: "view" });

  if (mode.kind === "revision") return <Sheet title={name} onClose={onClose}><RevisionForm s={s} from={mode.from} onCancel={back} onSave={(revisions, text) => patch(text, { revisions })} /></Sheet>;
  if (mode.kind === "overtime") return <Sheet title={name} onClose={onClose}><OvertimeForm s={s} otId={mode.id} onCancel={back} onSave={(list, text) => patch(text, { overtimes: list })} /></Sheet>;
  if (mode.kind === "deductions") return <Sheet title={name} onClose={onClose}><DeductionsForm s={s} onCancel={back} onSave={(p, text) => patch(text, p)} /></Sheet>;
  if (mode.kind === "end") return <Sheet title={name} onClose={onClose}><EndForm item={s} what="Último mes cobrado" onCancel={back} onSave={(end, text) => patch(text, { end })} /></Sheet>;

  const b = core.salaryBreakdown(id, currentMonth);
  const lines = core.salaryDeductionLines(id, currentMonth);
  const rows: [ReactNode, number, string?][] = [["Bruto", b.base]];
  if (b.atrasos) rows.push(["Atrasos de subidas", b.atrasos]);
  if (b.horas_extra) rows.push(["Horas extra y pagas", b.horas_extra]);
  for (const l of lines) rows.push([<>{l.name} <em>{pct(l.rate)}</em></>, -l.amount, "minus"]);
  const active = !s.end || String(s.end).slice(0, 7) >= currentMonth;

  return (
    <Sheet title="Nómina" onClose={onClose}>
      <EditableName name={name} onSave={(n) => save("Nombre cambiado", patchItem(uid, "salaries", id, { name: n }, s))} />
      <p className="muted small">Se cobra en {nameOf(docs.accounts, s.accountId as string)}. Desde {monthLong(String(s.start).slice(0, 7))}{s.end ? ` hasta ${monthLong(String(s.end).slice(0, 7))}` : ""}.</p>
      {active ? <Calc title={`Este mes, ${monthLong(currentMonth)}`} rows={rows} total={["Neto", b.neto]} /> : <p className="muted">Esta nómina ya terminó.</p>}

      <ChangeList title="Subidas y cambios de bruto" addLabel="Añadir" empty="Sin cambios: cobra el bruto inicial."
        onAdd={() => setMode({ kind: "revision" })}
        items={[
          ...revs.map((r) => ({
            key: r.from, text: <>Desde {monthLong(r.from)}: {formatEuros(r.gross as number)}</>,
            sub: r.paidFrom ? `Cobrado desde ${monthLong(r.paidFrom as string)}, con atrasos` : undefined,
            onEdit: () => setMode({ kind: "revision", from: r.from }),
            onRemove: () => patch("Cambio quitado", { revisions: removeRevision(s.revisions as Rev[], r.from) }),
          })),
        ]} />
      <p className="muted small base-line">Bruto inicial: {formatEuros(s.grossMonthly as number)} desde {monthLong(String(s.start).slice(0, 7))}.</p>

      <ChangeList title="Horas extra y pagas" addLabel="Añadir" empty="Ninguna."
        onAdd={() => setMode({ kind: "overtime" })}
        items={overtimes.map((o) => ({
          key: String(o.id), text: <>{monthLong(o.month as string)}: {formatEuros(o.gross as number)}</>, sub: "Bruto",
          onEdit: () => setMode({ kind: "overtime", id: String(o.id) }),
          onRemove: () => patch("Quitado", { overtimes: (s.overtimes as Raw[]).filter((x) => x.id !== o.id) }),
        }))} />

      <div className="quiet-actions">
        <button className="link" onClick={() => setMode({ kind: "deductions" })}>Editar deducciones</button>
        {s.end
          ? <button className="link" onClick={() => patch("Reanudada", { end: null })}>Quitar la fecha de fin</button>
          : <button className="link danger" onClick={() => setMode({ kind: "end" })}>Terminar nómina</button>}
      </div>
    </Sheet>
  );
}

function RevisionForm({ s, from: editFrom, onCancel, onSave }: {
  s: Raw; from?: Month; onCancel: () => void; onSave: (revs: Rev[], text: string) => void;
}) {
  const { currentMonth } = useCtx();
  const revs = (s.revisions as Rev[] | undefined) ?? [];
  const cur = editFrom ? revs.find((r) => r.from === editFrom) : undefined;
  const [from, setFrom] = useState<Month>(cur?.from ?? currentMonth);
  const [gross, setGross] = useState(cur ? euros(cur.gross) : "");
  const [late, setLate] = useState(!!cur?.paidFrom);
  const [paidFrom, setPaidFrom] = useState<Month>((cur?.paidFrom as Month) ?? currentMonth);
  const v = parseAmount(gross);
  const rev: Rev = { from, gross: v, ...(late && paidFrom > from ? { paidFrom } : {}) };
  return (
    <>
      <h3 className="form-title">{cur ? "Editar cambio de bruto" : "Subida o cambio de bruto"}</h3>
      <Field label="Nuevo bruto mensual"><AmountInput value={gross} onChange={setGross} ariaLabel="Nuevo bruto" /></Field>
      <Field label="Con efecto desde"><MonthSelect value={from} onChange={setFrom} min={String(s.start).slice(0, 7)} /></Field>
      <label className="check"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} />Se empezó a cobrar más tarde (con atrasos)</label>
      {late && <Field label="Primer mes que se cobró con la subida" hint="Ese mes se suman los atrasos de los meses anteriores.">
        <MonthSelect value={paidFrom} onChange={setPaidFrom} min={from} /></Field>}
      {pastWarning(late ? paidFrom : from, currentMonth)}
      <FormActions onCancel={onCancel}>
        <button className="btn primary wide" disabled={!(v && v > 0)} onClick={() =>
          onSave(cur ? replaceRevision(revs, cur.from, rev) : withRevision(revs, rev), cur ? "Cambio editado" : "Cambio añadido")}>Guardar</button>
      </FormActions>
    </>
  );
}

function OvertimeForm({ s, otId, onCancel, onSave }: { s: Raw; otId?: string; onCancel: () => void; onSave: (list: Raw[], text: string) => void }) {
  const { currentMonth } = useCtx();
  const list = (s.overtimes as Raw[] | undefined) ?? [];
  const cur = otId ? list.find((o) => String(o.id) === otId) : undefined;
  const [month, setMonth] = useState<Month>((cur?.month as Month) ?? currentMonth);
  const [gross, setGross] = useState(cur ? euros(cur.gross) : "");
  const v = parseAmount(gross);
  return (
    <>
      <h3 className="form-title">{cur ? "Editar horas extra o paga" : "Horas extra o paga"}</h3>
      <Field label="Mes en que se cobra"><MonthSelect value={month} onChange={setMonth} /></Field>
      <Field label="Importe bruto"><AmountInput value={gross} onChange={setGross} ariaLabel="Importe bruto" /></Field>
      {pastWarning(month, currentMonth)}
      <FormActions onCancel={onCancel}>
        <button className="btn primary wide" disabled={!(v && v > 0)} onClick={() => onSave(
          cur ? list.map((o) => (o === cur ? { ...o, month, gross: v } : o)) : [...list, { id: localId(), month, gross: v }],
          cur ? "Editado" : "Añadido")}>Guardar</button>
      </FormActions>
    </>
  );
}

function DeductionsForm({ s, onCancel, onSave }: { s: Raw; onCancel: () => void; onSave: (p: Raw, text: string) => void }) {
  const { currentMonth } = useCtx();
  const dedRevs = (s.deductionRevisions as Rev[] | undefined) ?? [];
  const [from, setFrom] = useState<Month>(addMonths(currentMonth, 1));
  const cur = (valueInMonth(s, dedRevs, "deductions", from) as Raw[]) ?? [];
  const [rows, setRows] = useState<DedRow[]>(toRows(cur));
  const { deds, errors } = rowsToDeds(rows);
  return (
    <>
      <h3 className="form-title">Deducciones</h3>
      <p className="muted small">Los cambios valen a partir del mes que elijas; los anteriores no cambian.</p>
      <Deductions rows={rows} setRows={setRows} />
      <Field label="A partir de"><MonthSelect value={from} onChange={setFrom} /></Field>
      {pastWarning(from, currentMonth)}
      <Errors list={errors} />
      {dedRevs.length > 0 && <ul className="mini-list">{dedRevs.map((r) => <li key={r.from}>Desde {monthLong(r.from)}: {(r.deductions as Raw[]).filter((x) => x.name).map((x) => `${x.name} ${pct(Number(x.rate))}`).join(", ") || "sin deducciones"}</li>)}</ul>}
      <FormActions onCancel={onCancel}>
        <button className="btn primary wide" disabled={errors.length > 0} onClick={() =>
          onSave({ deductionRevisions: withRevision(dedRevs, { from, deductions: deds }) }, `Deducciones desde ${monthLong(from)}`)}>
          Guardar desde {monthLong(from)}</button>
      </FormActions>
    </>
  );
}

function EndForm({ item, what, onCancel, onSave, warn }: {
  item: Raw; what: string; onCancel: () => void; onSave: (end: string, text: string) => void; warn?: (last: Month) => ReactNode;
}) {
  const { currentMonth } = useCtx();
  const [last, setLast] = useState<Month>(item.end ? String(item.end).slice(0, 7) : currentMonth);
  return (
    <>
      <h3 className="form-title">Terminar</h3>
      <Field label={what}><MonthSelect value={last} onChange={setLast} min={String(item.start).slice(0, 7)} /></Field>
      {warn?.(last)}
      <FormActions onCancel={onCancel}>
        <button className="btn primary wide" onClick={() => onSave(endOfMonth(last), `Termina en ${monthLong(last)}`)}>Terminar en {monthLong(last)}</button>
      </FormActions>
    </>
  );
}

// =============================================================================== gastos fijos

type FixedMode = { kind: "view" } | { kind: "change"; from?: Month } | { kind: "end" };

export function FixedDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { uid, docs, currentMonth, mainAccountId, toast } = useCtx();
  const [mode, setMode] = useState<FixedMode>({ kind: "view" });
  const fe = docs.fixedExpenses[id] as Raw | undefined;
  if (!fe) return null;
  const save = (text: string, undo: Undo) => { toast(text, undo); setMode({ kind: "view" }); };
  const patch = (text: string, p: Raw) => save(text, patchItem(uid, "fixedExpenses", id, p, fe));
  const revs = (fe.revisions as Rev[] | undefined) ?? [];
  const back = () => setMode({ kind: "view" });
  const name = fe.name as string;

  if (mode.kind === "change") return <Sheet title={name} onClose={onClose}><FixedChangeForm fe={fe} from={mode.from} onCancel={back} onSave={(r, t) => patch(t, { revisions: r })} /></Sheet>;
  if (mode.kind === "end") {
    return <Sheet title={name} onClose={onClose}><EndForm item={fe} what="Último mes que se paga" onCancel={back} onSave={(end, t) => patch(t, { end })}
      warn={(last) => { const lost = paymentsAfter(fe.payments as Raw, last); return lost.length ? <Warn>Tiene pagos marcados después ({lost.map(monthLong).join(", ")}): dejarían de contar.</Warn> : null; }} /></Sheet>;
  }

  const m = currentMonth;
  const amount = valueInMonth(fe, revs, "amount", m) as number;
  const acc = valueInMonth(fe, revs, "accountId", m) as string;
  const own = !!valueInMonth(fe, revs, "isOwnExpense", m);
  const pay = (fe.payments as Record<string, { status: string; amount: number | null }> | undefined) ?? {};
  const thisMonth = pay[m];
  const active = String(fe.start).slice(0, 7) <= m && (!fe.end || String(fe.end).slice(0, 7) >= m);
  const recent: Month[] = [];
  for (let i = 1; i <= 6; i++) {
    const mm = addMonths(m, -i);
    if (mm >= String(fe.start).slice(0, 7) && (!fe.end || mm <= String(fe.end).slice(0, 7))) recent.push(mm);
  }
  const sorted = revs.slice().sort((a, b) => (a.from < b.from ? 1 : -1));
  const describe = (r: Rev) => [
    r.amount !== undefined && formatEuros(r.amount as number),
    r.accountId && `desde ${nameOf(docs.accounts, r.accountId as string)}`,
    r.isOwnExpense !== undefined && (r.isOwnExpense ? "gasto propio" : "deja de ser propio"),
  ].filter(Boolean).join(", ");

  return (
    <Sheet title="Gasto fijo" onClose={onClose}>
      <EditableName name={name} onSave={(n) => save("Nombre cambiado", patchItem(uid, "fixedExpenses", id, { name: n }, fe))} />
      {active ? (
        <section className="calc" aria-label="Este mes">
          <h4>Este mes, {monthLong(m)}</h4>
          <div className="calc-row"><span>Importe</span><span>{formatEuros(amount)}</span></div>
          <div className="calc-row"><span>Se paga desde</span><span>{nameOf(docs.accounts, acc)}</span></div>
          <div className="calc-row"><span>Gasto propio</span><span>{own ? (acc === mainAccountId ? "Sí (en la principal: nada que reembolsar)" : "Sí, se reembolsa") : "No"}</span></div>
          <div className="calc-row total"><span>Estado</span><span>{thisMonth?.status === "paid" ? (thisMonth.amount === 0 ? "Sin gasto este mes" : `Pagado${thisMonth.amount != null ? ` (${formatEuros(thisMonth.amount)})` : ""}`) : "Pendiente"}</span></div>
        </section>
      ) : <p className="muted">{fe.end ? `Terminó en ${monthLong(String(fe.end).slice(0, 7))}.` : `Empieza en ${monthLong(String(fe.start).slice(0, 7))}.`}</p>}

      <label className="field inline-field"><span>Categoría</span>
        <CategorySelect value={(fe.categoryId as string) ?? ""} onChange={(c) => save(c ? `Categoría: ${nameOf(docs.categories, c)}` : "Sin categoría",
          patchItem(uid, "fixedExpenses", id, { categoryId: c || null, ...(c ? {} : { countsInBudget: false }) }, fe))} /></label>
      <InBudgetChoice categoryId={(fe.categoryId as string) ?? ""} accountId={acc} value={!!fe.countsInBudget}
        onChange={(v) => v !== !!fe.countsInBudget && save(v ? "Cuenta dentro del budget" : "Fuera del budget", patchItem(uid, "fixedExpenses", id, { countsInBudget: v }, fe))} />

      <ChangeList title="Cambios" addLabel="Añadir cambio" empty="Sin cambios desde que empezó."
        onAdd={() => setMode({ kind: "change" })}
        items={sorted.map((r) => ({
          key: r.from, text: <>Desde {monthLong(r.from)}</>, sub: describe(r) || "sin cambios",
          onEdit: () => setMode({ kind: "change", from: r.from }),
          onRemove: () => patch("Cambio quitado", { revisions: removeRevision(revs, r.from) }),
        }))} />
      <p className="muted small base-line">Al empezar ({monthLong(String(fe.start).slice(0, 7))}): {formatEuros(fe.amount as number)} desde {nameOf(docs.accounts, fe.accountId as string)}{fe.isOwnExpense ? ", gasto propio" : ""}.</p>

      {(() => {
        const p = paidSinceStart(pay, (mm) => Math.round(Number(valueInMonth(fe, revs, "amount", mm)) * 100), m);
        return <p className="paid-total"><span>Pagado desde el inicio</span><b>{formatCents(p.cents)}</b>
          <small>{p.months === 1 ? "1 mes pagado" : `${p.months} meses pagados`}</small></p>;
      })()}

      {recent.length > 0 && (
        <section className="changes">
          <h4>Últimos meses</h4>
          <ul className="rows compact">
            {recent.map((mm) => {
              const p = pay[mm];
              const amt = valueInMonth(fe, revs, "amount", mm) as number;
              return <li key={mm}><span className="what"><b>{monthLong(mm)}</b></span>
                <span className={`amt ${p?.status === "paid" ? "" : "muted"}`}>{p?.status === "paid" ? (p.amount === 0 ? "Sin gasto" : formatEuros(p.amount ?? amt)) : "Sin pagar"}</span></li>;
            })}
          </ul>
        </section>
      )}

      <div className="quiet-actions">
        {fe.end
          ? <button className="link" onClick={() => patch("Reanudado", { end: null })}>Quitar la fecha de fin</button>
          : <button className="link danger" onClick={() => setMode({ kind: "end" })}>Terminar gasto fijo</button>}
        {canDeleteFixed(fe) && <button className="link danger" onClick={() => { toast("Gasto fijo borrado", deleteItem(uid, "fixedExpenses", id, fe)); onClose(); }}>Borrar</button>}
      </div>
    </Sheet>
  );
}

function FixedChangeForm({ fe, from: editFrom, onCancel, onSave }: {
  fe: Raw; from?: Month; onCancel: () => void; onSave: (revs: Rev[], text: string) => void;
}) {
  const { currentMonth, mainAccountId, docs } = useCtx();
  const revs = (fe.revisions as Rev[] | undefined) ?? [];
  const cur = editFrom ? revs.find((r) => r.from === editFrom) : undefined;
  const others = cur ? revs.filter((r) => r !== cur) : revs;
  const [from, setFrom] = useState<Month>(cur?.from ?? addMonths(currentMonth, 1));
  // Lo vigente antes de este cambio (sin contarlo): sirve para rellenar y para guardar solo lo que cambia.
  const before = (field: string) => valueInMonth(fe, others, field, addMonths(from, -1) < String(fe.start).slice(0, 7) ? from : addMonths(from, -1));
  const [amount, setAmount] = useState(euros(cur?.amount ?? valueInMonth(fe, revs, "amount", cur?.from ?? addMonths(currentMonth, 1))));
  const [acc, setAcc] = useState<string>((cur?.accountId as string) ?? (valueInMonth(fe, revs, "accountId", cur?.from ?? addMonths(currentMonth, 1)) as string));
  const [own, setOwn] = useState<boolean>(cur?.isOwnExpense !== undefined ? !!cur.isOwnExpense : !!valueInMonth(fe, revs, "isOwnExpense", cur?.from ?? addMonths(currentMonth, 1)));
  const v = parseAmount(amount);
  const rev: Rev = { from };
  if (v !== null && Math.round(v * 100) !== Math.round(Number(before("amount")) * 100)) rev.amount = v;
  if (acc && acc !== before("accountId")) rev.accountId = acc;
  if (own !== !!before("isOwnExpense")) rev.isOwnExpense = own;
  const changes = Object.keys(rev).length > 1;
  return (
    <>
      <h3 className="form-title">{cur ? "Editar cambio" : "Nuevo cambio"}</h3>
      <Field label="A partir de"><MonthSelect value={from} onChange={setFrom} min={String(fe.start).slice(0, 7)} /></Field>
      <Field label="Importe"><AmountInput value={amount} onChange={setAmount} ariaLabel="Importe" /></Field>
      <Field label="Se paga desde"><AccountSelect value={acc} onChange={setAcc} include={acc} /></Field>
      <label className="check"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
        Es un gasto propio (lo reembolsas desde {nameOf(docs.accounts, mainAccountId)})</label>
      {own && acc === mainAccountId && <Warn>Se paga desde la cuenta principal: no hay nada que reembolsar.</Warn>}
      {pastWarning(from, currentMonth)}
      {!changes && <p className="muted small">Así es como ya está en {monthLong(from)}: cambia algún dato.</p>}
      <FormActions onCancel={onCancel}>
        <button className="btn primary wide" disabled={!(v && v > 0) || !changes} onClick={() =>
          onSave(cur ? replaceRevision(revs, cur.from, rev) : withRevision(revs, rev), cur ? "Cambio editado" : `Cambio desde ${monthLong(from)}`)}>
          Guardar desde {monthLong(from)}</button>
      </FormActions>
    </>
  );
}
