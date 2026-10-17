/**
 * Inicio provisional (Fase 5): comprueba de extremo a extremo que datos, motor y caché
 * funcionan. Las pantallas de verdad se diseñan en la Fase 6.
 */
import { pySum } from "@salary/engine";
import { useData } from "../data";
import { formatCents } from "../lib/money";

const monthName = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });

export default function Home() {
  const { ready, core, currentMonth, docs, mainAccountId } = useData();
  if (!ready || !core) return <div className="splash">Cargando tus datos…</div>;

  const s = core.monthSummary(currentMonth);
  const pending = core.pendingObligations(currentMonth);
  const pendingTotal = pySum(pending.map((p) => p.monto));
  const accounts = Object.entries(docs.accounts).filter(([, a]) => !a.archived);
  const name = (id: string | null) => (id && (docs.accounts[id]?.name as string)) || "—";

  return (
    <div className="page">
      <p className="eyebrow">{monthName(currentMonth)}</p>
      <h1 className="title-lg">Este mes</h1>

      <div className="tiles">
        <div className="tile accent"><span>Cierre previsto</span><strong>{formatCents(s.resultado_proyectado)}</strong></div>
        <div className="tile"><span>Real hoy</span><strong>{formatCents(s.resultado_real)}</strong></div>
        <div className="tile"><span>Pendiente de pagar</span><strong>{formatCents(pendingTotal)}</strong></div>
        <div className="tile"><span>Arrastre del mes anterior</span><strong>{formatCents(s.remaining_from_previous_month)}</strong></div>
      </div>

      <h2 className="title-sm">Cuentas</h2>
      <ul className="list">
        {accounts.map(([id, a]) => (
          <li key={id}>
            <span>{a.name as string}{id === mainAccountId && <em className="badge">principal</em>}</span>
            <span className="num">{formatCents(core.realBalance(id, currentMonth))}<small>proyectado {formatCents(core.projectedBalance(id, currentMonth).resultado)}</small></span>
          </li>
        ))}
      </ul>

      {pending.length > 0 && <>
        <h2 className="title-sm">Pendiente este mes</h2>
        <ul className="list">
          {pending.map((p, i) => (
            <li key={i}><span>{p.tipo} · {p.tipo === "Gasto fijo" ? p.concepto : name(p.account_id)}</span><span className="num">{formatCents(p.monto)}</span></li>
          ))}
        </ul>
      </>}
      <p className="muted small">Vista provisional: el diseño definitivo llega en la Fase 6.</p>
    </div>
  );
}
