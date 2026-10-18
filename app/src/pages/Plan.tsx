/** Plan: lo que se repite cada mes (nómina, gastos fijos, budgets y tarjetas). Tocar para cambiar. */
import { useState } from "react";
import { budgetAmountForMonth, fixedAccountForMonth, fixedAmountForMonth, fixedIsOwnForMonth, type Month } from "@salary/engine";
import { BudgetEditor, CardEditor, FixedEditor, SalaryEditor } from "../components/PlanEditors";
import ScreenHeader from "../components/ScreenHeader";
import { useData } from "../data";
import { monthLong, nameOf } from "../lib/format";
import { formatCents } from "../lib/money";

type Editing = { kind: "fixed" | "budget" | "salary" | "card"; id: string | null } | null;

export default function Plan() {
  const { ready, core, docs, currentMonth } = useData();
  const [editing, setEditing] = useState<Editing>(null);
  if (!ready || !core) return <div className="splash">Cargando tus datos…</div>;
  const m: Month = currentMonth;
  const acc = (id: string | null) => nameOf(docs.accounts, id);
  const isLive = (x: { end: string | null }) => !x.end || x.end.slice(0, 7) >= m;
  const future = (x: { start: string }) => x.start.slice(0, 7) > m;
  const open = (kind: NonNullable<Editing>["kind"], id: string | null) => () => setEditing({ kind, id });
  const ends = (x: { end: string | null }) => (x.end ? `, hasta ${monthLong(x.end.slice(0, 7))}` : "");
  const starts = (x: { start: string }) => (future(x) ? `, desde ${monthLong(x.start.slice(0, 7))}` : "");

  const salaries = core.data.salaries.filter(isLive);
  const fixed = core.data.fixedExpenses.filter(isLive);
  const budgets = core.data.budgets.filter(isLive);
  const endedFixed = core.data.fixedExpenses.filter((x) => !isLive(x));
  const endedBudgets = core.data.budgets.filter((x) => !isLive(x));
  const endedSalaries = core.data.salaries.filter((x) => !isLive(x));
  const cards = Object.entries(docs.cards).sort(([, a], [, b]) => String(a.name).localeCompare(String(b.name), "es"));
  const fixedTotal = fixed.filter((f) => !future(f)).reduce((t, f) => t + fixedAmountForMonth(f, m), 0);

  const Head = ({ title, onAdd }: { title: string; onAdd: () => void }) => (
    <div className="section-head"><h2 className="title-sm">{title}</h2><button className="link" onClick={onAdd}>Añadir</button></div>
  );

  return (
    <div className="page">
      <ScreenHeader id="plan" />
      <p className="muted">Lo que se repite cada mes. Los importes son los de {monthLong(m)}; los cambios se aplican desde el mes que elijas.</p>

      <Head title="Nómina" onAdd={open("salary", null)} />
      <ul className="rows">
        {salaries.length === 0 && <li className="empty">Sin nómina.</li>}
        {salaries.map((s) => {
          const b = core.salaryBreakdown(s.id, m);
          return <li key={s.id}><button className="what plain" onClick={open("salary", s.id)}><b>{(docs.salaries[s.id]?.name as string) || "Nómina"}</b>
            <small>Bruto {formatCents(b.base)}, deducciones {formatCents(b.deducciones)}, en {acc(s.accountId)}{starts(s)}{ends(s)}</small></button>
            <span className="amt">{formatCents(b.neto)}<small>neto</small></span></li>;
        })}
      </ul>

      <Head title="Gastos fijos" onAdd={open("fixed", null)} />
      <ul className="rows">
        {fixed.length === 0 && <li className="empty">Sin gastos fijos.</li>}
        {fixed.map((f) => <li key={f.id}><button className="what plain" onClick={open("fixed", f.id)}><b>{f.name}</b>
          <small>{acc(fixedAccountForMonth(f, m))}{fixedIsOwnForMonth(f, m) ? ", gasto propio" : ""}{starts(f)}{ends(f)}</small></button>
          <span className="amt">{formatCents(fixedAmountForMonth(f, m))}</span></li>)}
        {fixed.length > 1 && <li><span className="what"><b>Total este mes</b></span><span className="amt">{formatCents(fixedTotal)}</span></li>}
      </ul>

      <Head title="Budgets" onAdd={open("budget", null)} />
      <ul className="rows">
        {budgets.length === 0 && <li className="empty">Sin budgets.</li>}
        {budgets.map((b) => <li key={b.id}><button className="what plain" onClick={open("budget", b.id)}><b>{nameOf(docs.categories, b.categoryId, "Sin categoría")}</b>
          <small>{acc(b.accountId)}{starts(b)}{ends(b)}</small></button><span className="amt">{formatCents(budgetAmountForMonth(b, m))}</span></li>)}
      </ul>

      <Head title="Tarjetas de crédito" onAdd={open("card", null)} />
      <ul className="rows">
        {cards.length === 0 && <li className="empty">Sin tarjetas.</li>}
        {cards.map(([id, c]) => <li key={id} className={c.archived ? "archived" : ""}><button className="what plain" onClick={open("card", id)}><b>{c.name as string}{c.archived ? " (archivada)" : ""}</b>
          <small>Se paga desde {acc(c.accountId as string)}. {c.cutoffDay ? `Corte el día ${c.cutoffDay}` : "Se cobra el mes siguiente"}.</small></button></li>)}
      </ul>

      {(endedFixed.length + endedBudgets.length + endedSalaries.length) > 0 && (
        <details className="done-list">
          <summary>Terminados ({endedFixed.length + endedBudgets.length + endedSalaries.length})</summary>
          <ul className="rows done">
            {endedSalaries.map((s) => <li key={s.id}><button className="what plain" onClick={open("salary", s.id)}><b>{(docs.salaries[s.id]?.name as string) || "Nómina"}</b><small>Nómina{ends(s)}</small></button></li>)}
            {endedFixed.map((f) => <li key={f.id}><button className="what plain" onClick={open("fixed", f.id)}><b>{f.name}</b><small>Gasto fijo{ends(f)}</small></button></li>)}
            {endedBudgets.map((b) => <li key={b.id}><button className="what plain" onClick={open("budget", b.id)}><b>{nameOf(docs.categories, b.categoryId, "Sin categoría")}</b><small>Budget{ends(b)}</small></button></li>)}
          </ul>
        </details>
      )}

      {editing?.kind === "fixed" && <FixedEditor id={editing.id} onClose={() => setEditing(null)} />}
      {editing?.kind === "budget" && <BudgetEditor id={editing.id} onClose={() => setEditing(null)} />}
      {editing?.kind === "salary" && <SalaryEditor id={editing.id} onClose={() => setEditing(null)} />}
      {editing?.kind === "card" && <CardEditor id={editing.id} onClose={() => setEditing(null)} />}
    </div>
  );
}
