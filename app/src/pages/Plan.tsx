/** Plan: lo que se repite cada mes (nómina, gastos fijos y budgets; las tarjetas están en Ajustes → cuentas). Tocar para cambiar. */
import { useState } from "react";
import { budgetAmountForMonth, fixedAccountForMonth, fixedAmountForMonth, fixedIsOwnForMonth, type Month } from "@salary/engine";
import { FixedDetail, SalaryDetail } from "../components/PlanDetail";
import { BudgetEditor, FixedEditor, SalaryEditor } from "../components/PlanEditors";
import Fold from "../components/Fold";
import ScreenHeader from "../components/ScreenHeader";
import { useData } from "../data";
import { monthLong, nameOf } from "../lib/format";
import { formatCents } from "../lib/money";
import { paidSinceStart } from "../lib/plan";

type Editing = { kind: "fixed" | "budget" | "salary"; id: string | null } | null;

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
  const fixedTotal = fixed.filter((f) => !future(f)).reduce((t, f) => t + fixedAmountForMonth(f, m), 0);

  const salaryNet = salaries.filter((x) => !future(x)).reduce((t, x) => t + core.salaryBreakdown(x.id, m).neto, 0);
  const budgetTotal = budgets.filter((b) => !future(b)).reduce((t, b) => t + budgetAmountForMonth(b, m), 0);
  const paid = (f: (typeof fixed)[number]) => paidSinceStart(docs.fixedExpenses[f.id]?.payments as never, (mm) => fixedAmountForMonth(f, mm), m);
  const paidLine = (f: (typeof fixed)[number]) => {
    const p = paid(f);
    return p.months ? `Pagado desde el inicio: ${formatCents(p.cents)} (${p.months === 1 ? "1 mes" : `${p.months} meses`})` : "Aún sin pagos marcados";
  };
  const Add = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button className="btn wide ghost fold-add" onClick={onClick}>{label}</button>
  );

  return (
    <div className="page">
      <ScreenHeader id="plan" />
      <p className="muted">Lo que se repite cada mes. Los importes son los de {monthLong(m)}; los cambios se aplican desde el mes que elijas.</p>

      <Fold title="Nómina" total={formatCents(salaryNet)} sub="neto este mes">
        <ul className="rows">
          {salaries.length === 0 && <li className="empty">Sin nómina.</li>}
          {salaries.map((s) => {
            const b = core.salaryBreakdown(s.id, m);
            return <li key={s.id}><button className="what plain" onClick={open("salary", s.id)}><b>{(docs.salaries[s.id]?.name as string) || "Nómina"}</b>
              <small>Bruto {formatCents(b.base)}, deducciones {formatCents(b.deducciones)}, en {acc(s.accountId)}{starts(s)}{ends(s)}</small></button>
              <span className="amt">{formatCents(b.neto)}<small>neto</small></span></li>;
          })}
        </ul>
        <Add label="Añadir nómina" onClick={open("salary", null)} />
      </Fold>

      <Fold title="Gastos fijos" total={formatCents(fixedTotal)} sub={`${fixed.length === 1 ? "1 gasto" : `${fixed.length} gastos`} este mes`}>
        <ul className="rows">
          {fixed.length === 0 && <li className="empty">Sin gastos fijos.</li>}
          {fixed.map((f) => <li key={f.id}><button className="what plain" onClick={open("fixed", f.id)}><b>{f.name}</b>
            <small>{acc(fixedAccountForMonth(f, m))}{fixedIsOwnForMonth(f, m) ? ", gasto propio" : ""}{starts(f)}{ends(f)}</small>
            <small>{paidLine(f)}</small></button>
            <span className="amt">{formatCents(fixedAmountForMonth(f, m))}</span></li>)}
        </ul>
        <Add label="Añadir gasto fijo" onClick={open("fixed", null)} />
      </Fold>

      <Fold title="Budgets" total={formatCents(budgetTotal)} sub="este mes">
        <ul className="rows">
          {budgets.length === 0 && <li className="empty">Sin budgets.</li>}
          {budgets.map((b) => <li key={b.id}><button className="what plain" onClick={open("budget", b.id)}><b>{nameOf(docs.categories, b.categoryId, "Sin categoría")}</b>
            <small>{acc(b.accountId)}{starts(b)}{ends(b)}</small></button><span className="amt">{formatCents(budgetAmountForMonth(b, m))}</span></li>)}
        </ul>
        <Add label="Añadir budget" onClick={open("budget", null)} />
      </Fold>

      <p className="muted small">Las tarjetas de crédito se configuran en Ajustes, dentro de la cuenta desde la que se pagan.</p>

      {(endedFixed.length + endedBudgets.length + endedSalaries.length) > 0 && (
        <details className="done-list">
          <summary>Terminados ({endedFixed.length + endedBudgets.length + endedSalaries.length})</summary>
          <ul className="rows done">
            {endedSalaries.map((s) => <li key={s.id}><button className="what plain" onClick={open("salary", s.id)}><b>{(docs.salaries[s.id]?.name as string) || "Nómina"}</b><small>Nómina{ends(s)}</small></button></li>)}
            {endedFixed.map((f) => <li key={f.id}><button className="what plain" onClick={open("fixed", f.id)}><b>{f.name}</b><small>Gasto fijo{ends(f)}. {paidLine(f)}</small></button></li>)}
            {endedBudgets.map((b) => <li key={b.id}><button className="what plain" onClick={open("budget", b.id)}><b>{nameOf(docs.categories, b.categoryId, "Sin categoría")}</b><small>Budget{ends(b)}</small></button></li>)}
          </ul>
        </details>
      )}

      {editing?.kind === "fixed" && (editing.id ? <FixedDetail id={editing.id} onClose={() => setEditing(null)} /> : <FixedEditor id={null} onClose={() => setEditing(null)} />)}
      {editing?.kind === "budget" && <BudgetEditor id={editing.id} onClose={() => setEditing(null)} />}
      {editing?.kind === "salary" && (editing.id ? <SalaryDetail id={editing.id} onClose={() => setEditing(null)} /> : <SalaryEditor id={null} onClose={() => setEditing(null)} />)}
    </div>
  );
}
