/** Movimientos por día, con búsqueda por texto, categoría, cuenta y fechas. Tocar uno lo abre para editarlo o borrarlo. */
import { useState } from "react";
import { addMonths, type Month } from "@salary/engine";
import { IconNext, IconPrev } from "../components/Icons";
import ScreenHeader from "../components/ScreenHeader";
import { useData } from "../data";
import { dayLong, monthLong, monthName, nameOf } from "../lib/format";
import { formatEuros } from "../lib/money";
import { fillFigures } from "../lib/fuel";
import { isFiltering, matches, NO_CATEGORY, type MovFilter } from "../lib/movfilter";
import { useUI } from "../ui";

type Raw = Record<string, unknown>;
const KIND: Record<string, string> = { normal: "Transferencia", loan: "Préstamo", loanRepayment: "Devolución de préstamo", ownExpenseRefund: "Reembolso de gastos propios" };

/** «40,0 L, 6,7 L/100 km» de un repostaje, si tiene datos. */
function fillFromMovement(m: Raw): string | null {
  const f = m.fuel as { km?: number; pricePerLiter?: number } | undefined;
  if (!f || !(Number(f.pricePerLiter) > 0)) return null;
  const r = fillFigures(Number(m.amount), Number(f.km) || 0, Number(f.pricePerLiter));
  const n1 = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n1(r.liters)} L${r.lPer100 !== null ? `, ${n1(r.lPer100)} L/100 km` : ""}`;
}

export default function Movements() {
  const { ready, docs, currentMonth } = useData();
  const { openQuickAdd } = useUI();
  const [month, setMonth] = useState<Month>(currentMonth);
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  if (!ready) return <div className="splash">Cargando tus datos…</div>;

  const acc = (id: unknown) => nameOf(docs.accounts, id as string);
  const cat = (id: unknown) => (id ? nameOf(docs.categories, id as string, "Sin categoría") : "Sin categoría");
  const f: MovFilter = { text: q, categoryId, accountId, ...(range ? { from, to } : { month }) };
  const filtering = isFiltering(f);
  const names = { accounts: docs.accounts, categories: docs.categories, cards: docs.cards };
  const all = Object.entries(docs.movements)
    .filter(([, m]) => matches(m, f, names))
    .sort(([ia, a], [ib, b]) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || ib.localeCompare(ia));
  const LIMIT = 300;
  const items = all.slice(0, LIMIT);
  const days = new Map<string, [string, Raw][]>();
  for (const it of items) {
    const d = it[1].date as string;
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(it);
  }
  const sum = (type: string) => all.filter(([, m]) => m.type === type).reduce((s, [, m]) => s + Math.round((m.amount as number) * 100), 0);
  const spent = sum("expense");
  const earned = sum("income");
  const summary = `${all.length === 1 ? "1 movimiento" : `${all.length} movimientos`}, ${formatEuros(spent / 100)} en gastos${earned ? `, ${formatEuros(earned / 100)} en ingresos` : ""}`;
  const byName = (col: Record<string, Raw>) => Object.entries(col)
    .sort(([, a], [, b]) => Number(!!a.archived) - Number(!!b.archived) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "es"));
  const activeCount = [categoryId, accountId, range].filter(Boolean).length;
  const clear = () => { setQ(""); setCategoryId(""); setAccountId(""); setRange(false); setFrom(""); setTo(""); };

  const describe = (m: Raw) => {
    if (m.type === "expense") {
      const card = m.card as { cardId: string; chargeMonth: string } | undefined;
      const base = card ? `${nameOf(docs.cards, card.cardId, "Tarjeta")}, se cobra en ${monthName(card.chargeMonth)}` : `${cat(m.categoryId)}, ${acc(m.accountId)}`;
      const f = fillFromMovement(m);
      return f ? `${base}. ${f}` : base;
    }
    if (m.type === "income") return `Ingreso en ${acc(m.accountId)}`;
    return `${KIND[m.transferKind as string] ?? "Transferencia"}: ${acc(m.accountId)} a ${acc(m.toAccountId)}`;
  };
  const sign = (m: Raw) => (m.type === "expense" ? -1 : m.type === "income" ? 1 : 0);

  return (
    <div className="page">
      <ScreenHeader id="movimientos" />
      {range ? (
        <p className="range-summary"><b>{from || to ? `${from ? dayLong(from) : "El principio"} – ${to ? dayLong(to) : "hoy"}` : "Todo el historial"}</b><small>{summary}</small></p>
      ) : (
        <div className="month-switch compact">
          <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior"><IconPrev /></button>
          <h2>{monthLong(month)}<small>{summary}</small></h2>
          <button onClick={() => setMonth(addMonths(month, 1))} disabled={month >= addMonths(currentMonth, 12)} aria-label="Mes siguiente"><IconNext /></button>
        </div>
      )}
      {!range && month !== currentMonth && (
        <div className="today-row"><button className="today-chip" onClick={() => setMonth(currentMonth)}>
          {month < currentMonth ? <>Ir a {monthName(currentMonth)} <IconNext /></> : <><IconPrev /> Volver a {monthName(currentMonth)}</>}</button></div>
      )}
      <div className="search-row">
        <input className="input search" type="search" placeholder="Buscar concepto, categoría o cuenta" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <button className={`btn filter-btn ${activeCount ? "on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          Filtros{activeCount ? ` (${activeCount})` : ""}</button>
      </div>
      {open && (
        <section className="filters" aria-label="Filtros">
          <label className="field"><span>Categoría</span>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas</option>
              {byName(docs.categories).map(([id, c]) => <option key={id} value={id}>{c.name as string}{c.archived ? " (archivada)" : ""}</option>)}
              <option value={NO_CATEGORY}>Gastos sin categoría</option>
            </select></label>
          <label className="field"><span>Cuenta</span>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Todas</option>
              {byName(docs.accounts).map(([id, a]) => <option key={id} value={id}>{a.name as string}{a.archived ? " (archivada)" : ""}</option>)}
            </select></label>
          <div className="field"><span>Fechas</span>
            <div className="segmented" role="group" aria-label="Fechas">
              <button aria-pressed={!range} onClick={() => setRange(false)}>Por mes</button>
              <button aria-pressed={range} onClick={() => setRange(true)}>Entre fechas</button>
            </div></div>
          {range && <div className="date-range">
            <label className="field"><span>Desde</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>Hasta</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          </div>}
          {range && <p className="muted small">Deja una fecha vacía para no poner límite; las dos vacías buscan en todo el historial.</p>}
          {filtering && <button className="link" onClick={clear}>Quitar filtros</button>}
        </section>
      )}
      {items.length === 0 && <div className="placeholder">{filtering ? "Nada coincide con la búsqueda." : "Sin movimientos este mes. Añade uno con el botón +."}</div>}
      {[...days].map(([day, list]) => (
        <section key={day}>
          <h2 className="day-head">{dayLong(day)}</h2>
          <ul className="rows">
            {list.map(([id, m]) => (
              <li key={id}>
                <button className="what plain" onClick={() => openQuickAdd({ edit: { id, data: m } })}>
                  <b>{(m.description as string) || (m.type === "transfer" ? KIND[m.transferKind as string] ?? "Transferencia" : "Sin concepto")}</b>
                  <small>{describe(m)}</small>
                </button>
                <span className={`amt ${sign(m) < 0 ? "" : sign(m) > 0 ? "pos" : "muted"}`}>
                  {formatEuros((sign(m) || 1) * (m.amount as number))}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {all.length > LIMIT && <p className="muted small">Se muestran los {LIMIT} más recientes de {all.length}. Acota las fechas para ver el resto; el total de arriba sí los cuenta todos.</p>}
    </div>
  );
}
