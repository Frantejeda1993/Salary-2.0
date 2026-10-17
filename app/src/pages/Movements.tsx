/** Movimientos del mes, por día. Tocar uno muestra su detalle y permite borrarlo. */
import { useState } from "react";
import { addMonths, monthOf, type Month } from "@salary/engine";
import { IconNext, IconPrev } from "../components/Icons";
import Sheet from "../components/Sheet";
import { useAuth } from "../auth";
import { useData } from "../data";
import { deleteMovement } from "../lib/actions";
import { dayLong, monthLong, monthName, nameOf } from "../lib/format";
import { formatEuros } from "../lib/money";
import { useUI } from "../ui";

type Raw = Record<string, unknown>;
const KIND: Record<string, string> = { normal: "Transferencia", loan: "Préstamo", loanRepayment: "Devolución de préstamo", ownExpenseRefund: "Reembolso de gastos propios" };

export default function Movements() {
  const { user } = useAuth();
  const { ready, docs, currentMonth } = useData();
  const { toast } = useUI();
  const [month, setMonth] = useState<Month>(currentMonth);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<[string, Raw] | null>(null);
  if (!ready) return <div className="splash">Cargando tus datos…</div>;

  const acc = (id: unknown) => nameOf(docs.accounts, id as string);
  const cat = (id: unknown) => (id ? nameOf(docs.categories, id as string, "Sin categoría") : "Sin categoría");
  const t = q.trim().toLocaleLowerCase("es");
  const items = Object.entries(docs.movements)
    .filter(([, m]) => monthOf(m.date as string) === month)
    .filter(([, m]) => !t || String(m.description ?? "").toLocaleLowerCase("es").includes(t))
    .sort(([ia, a], [ib, b]) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || ib.localeCompare(ia));
  const days = new Map<string, [string, Raw][]>();
  for (const it of items) {
    const d = it[1].date as string;
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(it);
  }
  const spent = items.filter(([, m]) => m.type === "expense").reduce((s, [, m]) => s + Math.round((m.amount as number) * 100), 0);

  const describe = (m: Raw) => {
    if (m.type === "expense") {
      const card = m.card as { cardId: string; chargeMonth: string } | undefined;
      return card ? `${nameOf(docs.cards, card.cardId, "Tarjeta")}, se cobra en ${monthName(card.chargeMonth)}` : `${cat(m.categoryId)}, ${acc(m.accountId)}`;
    }
    if (m.type === "income") return `Ingreso en ${acc(m.accountId)}`;
    return `${KIND[m.transferKind as string] ?? "Transferencia"}: ${acc(m.accountId)} a ${acc(m.toAccountId)}`;
  };
  const sign = (m: Raw) => (m.type === "expense" ? -1 : m.type === "income" ? 1 : 0);

  return (
    <div className="page">
      <div className="month-switch">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior"><IconPrev /></button>
        <h1>{monthLong(month)}<small>{items.length} movimientos, {formatEuros(spent / 100)} en gastos</small></h1>
        <button onClick={() => setMonth(addMonths(month, 1))} disabled={month >= addMonths(currentMonth, 12)} aria-label="Mes siguiente"><IconNext /></button>
      </div>
      <input className="input search" type="search" placeholder="Buscar por comercio o concepto" value={q} onChange={(e) => setQ(e.target.value)} />
      {items.length === 0 && <div className="placeholder">{t ? "Nada coincide con la búsqueda." : "Sin movimientos este mes. Añade uno con el botón +."}</div>}
      {[...days].map(([day, list]) => (
        <section key={day}>
          <h2 className="day-head">{dayLong(day)}</h2>
          <ul className="rows">
            {list.map(([id, m]) => (
              <li key={id}>
                <button className="what plain" onClick={() => setOpen([id, m])}>
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
      {open && (
        <Sheet title={(open[1].description as string) || "Movimiento"} onClose={() => setOpen(null)}>
          <p className="big-amount"><strong className="title-xl">{formatEuros(open[1].amount as number)}</strong></p>
          <p className="muted">{dayLong(open[1].date as string)}. {describe(open[1])}.</p>
          {(open[1].loan as { outstanding?: number } | undefined)?.outstanding !== undefined &&
            <p className="muted">Quedan {formatEuros((open[1].loan as { outstanding: number }).outstanding)} por devolver.</p>}
          <p className="muted small">Para cambiarlo, bórralo y vuelve a crearlo. La edición llega en la próxima entrega.</p>
          <button className="btn wide save" onClick={() => {
            const [id, data] = open;
            const undo = deleteMovement(user!.uid, id, data);
            setOpen(null);
            toast("Movimiento borrado", undo);
          }}>Borrar movimiento</button>
        </Sheet>
      )}
    </div>
  );
}
