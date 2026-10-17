/** Plan: lo que se repite cada mes (nómina, gastos fijos, budgets). De momento, solo lectura. */
import { useData } from "../data";
import { monthLong, nameOf, sortedLive } from "../lib/format";
import { formatCents } from "../lib/money";
import { budgetAmountForMonth, fixedAmountForMonth, type Month } from "@salary/engine";

export default function Plan() {
  const { ready, core, docs, currentMonth } = useData();
  if (!ready || !core) return <div className="splash">Cargando tus datos…</div>;
  const m: Month = currentMonth;
  const acc = (id: string | null) => nameOf(docs.accounts, id);
  const live = <T extends { start: string; end: string | null }>(x: T) => x.start.slice(0, 7) <= m && (!x.end || x.end.slice(0, 7) >= m);
  const salaries = core.data.salaries.filter(live);
  const fixed = core.data.fixedExpenses.filter(live);
  const budgets = core.data.budgets.filter(live);
  return (
    <div className="page">
      <h1 className="title-lg">Plan</h1>
      <p className="muted">Lo que se repite cada mes, tal como cuenta en {monthLong(m)}.</p>

      <h2 className="title-sm">Nómina</h2>
      <ul className="rows">
        {salaries.length === 0 && <li className="empty">Sin nómina.</li>}
        {salaries.map((s) => {
          const b = core.salaryBreakdown(s.id, m);
          return <li key={s.id}><span className="what"><b>{(docs.salaries[s.id]?.name as string) || "Nómina"}</b>
            <small>Bruto {formatCents(b.base)}, deducciones {formatCents(b.deducciones)}, en {acc(s.accountId)}</small></span>
            <span className="amt">{formatCents(b.neto)}<small>neto</small></span></li>;
        })}
      </ul>

      <h2 className="title-sm">Gastos fijos</h2>
      <ul className="rows">
        {fixed.length === 0 && <li className="empty">Sin gastos fijos.</li>}
        {fixed.map((f) => <li key={f.id}><span className="what"><b>{f.name}</b>
          <small>{acc(f.accountId)}{f.isOwn ? ", gasto propio" : ""}</small></span>
          <span className="amt">{formatCents(fixedAmountForMonth(f, m))}</span></li>)}
      </ul>

      <h2 className="title-sm">Budgets</h2>
      <ul className="rows">
        {budgets.length === 0 && <li className="empty">Sin budgets.</li>}
        {budgets.map((b) => <li key={b.id}><span className="what"><b>{nameOf(docs.categories, b.categoryId, "Sin categoría")}</b>
          <small>{acc(b.accountId)}</small></span><span className="amt">{formatCents(budgetAmountForMonth(b, m))}</span></li>)}
      </ul>

      <h2 className="title-sm">Tarjetas</h2>
      <ul className="rows">
        {sortedLive(docs.cards).length === 0 && <li className="empty">Sin tarjetas.</li>}
        {sortedLive(docs.cards).map(([id, c]) => <li key={id}><span className="what"><b>{c.name as string}</b>
          <small>Se paga desde {acc(c.accountId as string)}. {c.cutoffDay ? `Corte el día ${c.cutoffDay}` : "Se cobra el mes siguiente"}.</small></span></li>)}
      </ul>
      <p className="muted small">Crear y editar todo esto llega en la próxima entrega.</p>
    </div>
  );
}
