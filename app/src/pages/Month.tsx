/**
 * Mes: cómo vas a cerrar el mes y lo que queda por hacer para que sea verdad.
 * Todas las cifras salen del motor (céntimos); las acciones escriben en euros.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FinanceCore, addMonths, monthOf, outstandingOf, pySum, type Month } from "@salary/engine";
import AmountSheet from "../components/AmountSheet";
import ScreenHeader from "../components/ScreenHeader";
import { IconNext, IconPrev } from "../components/Icons";
import { useAuth } from "../auth";
import { useData } from "../data";
import {
  refundOwnExpenses, repayLoan, setFixedPayment, settleCard, toEuros, unsettleCard, deleteMovement, type Undo,
} from "../lib/actions";
import { budgetLevel, daysInMonth, groupByBank, monthLong, monthName, monthShort, nameOf, sortedLive } from "../lib/format";
import { formatCents } from "../lib/money";
import { todayIn } from "../lib/quickadd";
import { useUI } from "../ui";

type Raw = Record<string, unknown>;
type Payment = { status: "paid" | "unpaid"; amount: number | null } & Raw;

interface Todo {
  key: string; title: string; detail: string; cents: number; late?: boolean;
  button?: string; act?: (euros: number) => Undo; done?: string;
  sheet?: { title: string; confirm: string; maxCents?: number };
}

const MONTHS_AHEAD = 12;

export default function MonthPage() {
  const { user, profile } = useAuth();
  const { ready, core, currentMonth, docs, mainAccountId } = useData();
  const { toast } = useUI();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Todo | null>(null);

  if (!ready || !core) return <div className="splash">Cargando tus datos…</div>;
  if (!mainAccountId || !docs.accounts[mainAccountId]) {
    return <div className="placeholder">Falta la cuenta principal. Elígela en Ajustes.</div>;
  }

  const tz = profile?.settings?.timezone || "Europe/Madrid";
  const today = todayIn(tz);
  const hist = historyRange(docs.movements as Record<string, Raw>);
  const startMonth = hist && hist.first < profile!.settings.startMonth ? hist.first : profile!.settings.startMonth;
  const lastMonth = addMonths(currentMonth, MONTHS_AHEAD);
  const asked = params.get("mes");
  const month: Month = asked && /^\d{4}-\d{2}$/.test(asked) && asked >= startMonth && asked <= lastMonth ? asked : currentMonth;
  const go = (m: Month) => setParams(m === currentMonth ? {} : { mes: m }, { replace: true });
  if (hist && month <= hist.last && month < currentMonth) {
    return <HistoryMonth month={month} first={startMonth} last={lastMonth} go={go} />;
  }

  const phase = month < currentMonth ? "past" : month === currentMonth ? "current" : "future";
  const s = core.monthSummary(month);
  const main = mainAccountId;
  const accName = (id: string | null | undefined) => nameOf(docs.accounts, id);
  const uid = user!.uid;
  // Fecha de las acciones: hoy en el mes actual; el día 1 si se registra en un mes pasado (como la app vieja).
  const actionDate = phase === "current" ? today : `${month}-01`;
  const canAct = phase !== "future";

  const done = (text: string, undo: Undo) => toast(text, undo);

  // ---------------------------------------------------------------- pendientes
  const todos: Todo[] = [];
  const doneItems: Todo[] = [];

  for (const fe of core.fixedExpensesForMonth(month)) {
    const raw = docs.fixedExpenses[fe.id] as Raw;
    const prev = (raw.payments as Record<string, Payment> | undefined)?.[month];
    if (fe.estado === "impagado") {
      todos.push({
        key: `fe-${fe.id}`, title: fe.name, detail: `Gasto fijo desde ${accName(fe.account_id)}`, cents: fe.monto,
        button: "Pagado", sheet: { title: `Pagar ${fe.name}`, confirm: "Marcar pagado" },
        act: (euros) => {
          const amount = Math.round(euros * 100) === fe.monto ? null : euros;
          return setFixedPayment(uid, fe.id, month, { ...(prev ?? {}), status: "paid", amount }, prev);
        },
        done: `${fe.name}: pagado`,
      });
    } else {
      doneItems.push({
        key: `fe-${fe.id}`, title: fe.name, detail: "Gasto fijo pagado", cents: fe.monto_pagado ?? fe.monto,
        button: "Desmarcar", act: () => setFixedPayment(uid, fe.id, month, null, prev), done: `${fe.name}: sin pagar`,
      });
    }
  }

  for (const g of core.creditGroups()) {
    if (g.mes_cargo > month || g.settlement !== null) continue;
    const cardId = g.card_id ?? ((docs.movements[g.items[0].id] as Raw)?.card as { cardId?: string } | undefined)?.cardId ?? `card_${g.account_id}`;
    todos.push({
      key: `cc-${g.account_id}-${g.mes_cargo}`, title: nameOf(docs.cards, cardId, "Tarjeta"),
      detail: `Cargo de ${monthName(g.mes_cargo)} en ${accName(g.account_id)}`, cents: g.total, late: g.mes_cargo < month,
      button: "Saldar",
      act: () => settleCard(uid, { cardId, accountId: g.account_id!, chargeMonth: g.mes_cargo, date: actionDate, amount: toEuros(g.total) }),
      done: "Tarjeta saldada",
    });
  }
  // Pago de tarjeta que ya no cuadra con sus compras (se editó o añadió alguna después de saldar).
  // Igual que el motor (C): por tarjeta y mes de cargo.
  const groupTotal = new Map(core.creditGroups().map((g) => [`${g.card_id ?? g.account_id}|${g.mes_cargo}`, g.total]));
  for (const [id, st] of Object.entries(docs.cardSettlements)) {
    if (monthOf(st.date as string) !== month) continue;
    const paid = Math.round((st.amount as number) * 100);
    const total = groupTotal.get(`${(st.cardId as string) ?? st.accountId}|${st.chargeMonth}`) ?? 0;
    if (paid !== total) {
      todos.push({
        key: `mis-${id}`, title: `${nameOf(docs.cards, st.cardId as string, "Tarjeta")}: el pago no cuadra`,
        detail: `Saldaste ${formatCents(paid)}, pero las compras de ${monthName(st.chargeMonth as string)} suman ${formatCents(total)}. Deshaz el pago y vuelve a saldar.`,
        cents: total - paid, button: "Deshacer pago", act: () => unsettleCard(uid, id, st), done: "Pago de tarjeta deshecho",
      });
      continue;
    }
    doneItems.push({
      key: `st-${id}`, title: nameOf(docs.cards, st.cardId as string, "Tarjeta"), detail: `Cargo de ${monthName(st.chargeMonth as string)} saldado`,
      cents: Math.round((st.amount as number) * 100), button: "Deshacer", act: () => unsettleCard(uid, id, st), done: "Pago de tarjeta deshecho",
    });
  }

  for (const [acc, cents] of core.ownExpensesPending(month, main)) {
    todos.push({
      key: `own-${acc}`, title: `Reembolsar a ${accName(acc)}`, detail: `Gastos propios, desde ${accName(main)}`, cents,
      button: "Transferir", sheet: { title: `Reembolsar a ${accName(acc)}`, confirm: "Transferir" },
      act: (euros) => refundOwnExpenses(uid, { from: main, to: acc, amount: euros, date: actionDate }),
      done: "Reembolso registrado",
    });
  }
  for (const [id, m] of Object.entries(docs.movements)) {
    if (m.type !== "transfer" || m.transferKind !== "ownExpenseRefund" || monthOf(m.date as string) !== month) continue;
    doneItems.push({
      key: `rf-${id}`, title: `Reembolso a ${accName(m.toAccountId as string)}`, detail: "Gastos propios", cents: Math.round((m.amount as number) * 100),
      button: "Borrar", act: () => deleteMovement(uid, id, m), done: "Reembolso borrado",
    });
  }

  // ---------------------------------------------------------------- préstamos
  const loans = core.data.transfers.filter((t) => t.isLoan && (t.status ?? "pending") === "pending" && outstandingOf(t) > 0);
  const impact = core.pendingLoansImpact(main);

  // ---------------------------------------------------------------- héroe
  const real = s.resultado_real;
  const proj = s.resultado_proyectado;
  const committed = real - proj;
  const pendingCents = pySum(todos.filter((t) => !t.key.startsWith("mis-")).map((t) => t.cents));

  const hero = phase === "past"
    ? { label: `Cerraste ${monthName(month)} con`, value: real }
    : { label: phase === "current" ? "Cierre previsto" : `Cierre previsto de ${monthName(month)}`, value: proj };

  return (
    <div className="page month">
      <ScreenHeader id="mes" />
      <div className="month-switch">
        <button onClick={() => go(addMonths(month, -1))} disabled={month <= startMonth} aria-label="Mes anterior"><IconPrev /></button>
        <h1>{monthLong(month)}<small>{phase === "current" ? "Este mes" : phase === "past" ? "Mes cerrado" : "Previsión"}</small></h1>
        <button onClick={() => go(addMonths(month, 1))} disabled={month >= lastMonth} aria-label="Mes siguiente"><IconNext /></button>
      </div>

      <section className="closing" aria-label="Resultado del mes">
        <div className="label">{hero.label}</div>
        <div className={`figure ${hero.value < 0 ? "neg" : ""}`}>{formatCents(hero.value)}</div>
        {phase === "current" && (real > 0 ? (
          <>
            <div className={`ledger-bar ${proj < 0 ? "overdrawn" : ""}`} role="img"
                 aria-label={`Resultado real hasta hoy ${formatCents(real)}: ${formatCents(committed)} ya comprometidos, ${formatCents(proj)} libres al cierre`}>
              {proj > 0 && <div className="free" style={{ width: `${Math.min(100, (proj / real) * 100)}%` }} />}
              {committed > 0 && <div className="committed" />}
            </div>
            <div className="ledger-legend" aria-hidden="true">
              <span><i style={{ background: "var(--free)" }} />Libre al cierre <b>{formatCents(proj)}</b></span>
              <span><i style={{ background: proj < 0 ? "var(--out)" : "var(--committed)" }} />Comprometido <b>{formatCents(committed)}</b></span>
            </div>
          </>
        ) : <p className="muted small">Resultado real hasta hoy: {formatCents(real)}.</p>)}
        {phase !== "past" && (impact.debes !== 0 || impact.te_deben !== 0) && (
          <p className="loans-line">Si se saldan los préstamos pendientes: <b>{formatCents(proj + impact.neto)}</b>{" "}
            ({[impact.debes ? `devuelves ${formatCents(impact.debes)}` : "", impact.te_deben ? `te devuelven ${formatCents(impact.te_deben)}` : ""].filter(Boolean).join(" y ")})</p>
        )}
        {phase !== "past" && (s.deuda_tarjeta_arrastrada ?? 0) > 0 && (
          <p className="muted small">Incluye {formatCents(s.deuda_tarjeta_arrastrada!)} de tarjeta de meses anteriores, aún sin saldar.</p>
        )}
        {phase !== "past" && (s.reembolsos_propios_pendientes ?? 0) > 0 && (
          <p className="muted small">Ya descuenta {formatCents(s.reembolsos_propios_pendientes!)} de reembolsos de gastos propios.</p>
        )}
      </section>

      <div className="figures">
        {phase === "future" ? <>
          <div><span>Empiezas con</span><strong>{formatCents(s.remaining_from_previous_month)}</strong></div>
          <div><span>Nómina</span><strong>{formatCents(s.ingreso_total)}</strong></div>
          <div><span>Fijos</span><strong>{formatCents(s.gastos_fijos)}</strong></div>
        </> : <>
          <div><span>{phase === "current" ? "Real hoy" : "Real"}</span><strong>{formatCents(real)}</strong></div>
          <div><span>Arrastre</span><strong>{formatCents(s.remaining_from_previous_month)}</strong></div>
          <div><span>Por pagar</span><strong>{formatCents(pendingCents)}</strong></div>
        </>}
      </div>

      <h2 className="title-sm">{canAct ? "Por hacer" : "Previsto"}</h2>
      {todos.length === 0
        ? <div className="rows"><p className="empty">{canAct ? "Nada pendiente este mes." : "Nada previsto."}</p></div>
        : <ul className="rows">
            {todos.map((t) => (
              <li key={t.key}>
                <button className="what plain" onClick={() => canAct && t.sheet && setEditing(t)} disabled={!canAct || !t.sheet}>
                  <b>{t.title}</b><small>{t.detail}{t.late ? ", atrasado" : ""}</small>
                  {canAct && t.sheet && <span className="hint">Otro importe</span>}
                </button>
                <span className="act">
                  <span className="amt">{formatCents(t.cents)}</span>
                  {canAct && t.act && <button className="btn small" onClick={() => done(t.done!, t.act!(toEuros(t.cents)))}>{t.button}</button>}
                </span>
              </li>
            ))}
          </ul>}

      {doneItems.length > 0 && (
        <details className="done-list">
          <summary>Hecho este mes ({doneItems.length})</summary>
          <ul className="rows done">
            {doneItems.map((t) => (
              <li key={t.key}>
                <span className="what"><b>{t.title}</b><small>{t.detail}</small></span>
                <span className="act"><span className="amt">{formatCents(t.cents)}</span>
                  <button className="link" onClick={() => done(t.done!, t.act!(toEuros(t.cents)))}>{t.button}</button></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {phase === "current" && loans.length > 0 && <>
        <h2 className="title-sm">Préstamos pendientes</h2>
        <ul className="rows">
          {loans.map((t) => {
            const left = outstandingOf(t);
            const youOwe = t.to === main;
            const raw = docs.movements[t.id] as Raw;
            const label = youOwe ? `Te prestó ${accName(t.from)}` : t.from === main ? `Prestaste a ${accName(t.to)}` : `${accName(t.from)} a ${accName(t.to)}`;
            const todo: Todo = {
              key: t.id, title: label, detail: "", cents: left,
              sheet: { title: youOwe ? "Devolver préstamo" : "Registrar devolución", confirm: "Registrar devolución", maxCents: left },
              act: (euros) => repayLoan(uid, t.id, raw, euros, today),
              done: "Devolución registrada",
            };
            return (
              <li key={t.id}>
                <span className="what"><b>{label}</b>
                  <small>{left !== t.amount ? `Quedan ${formatCents(left)} de ${formatCents(t.amount)}, ` : ""}desde el {new Date(`${t.date}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</small></span>
                <span className="act"><span className={`amt ${youOwe ? "neg" : "pos"}`}>{formatCents(youOwe ? -left : left)}</span>
                  <button className="btn small" onClick={() => setEditing({ ...todo, title: todo.sheet!.title })}>Saldar</button></span>
              </li>
            );
          })}
        </ul>
      </>}

      <Budgets month={month} phase={phase} carry={s.remaining_from_previous_month} today={today} />

      <h2 className="title-sm">Cuentas</h2>
      {groupByBank(sortedLive(docs.accounts)).map(({ bank, accounts }) => {
        const pbs = accounts.map(([id]) => core.projectedBalance(id, month).resultado);
        const total = pbs.reduce((x, y) => x + y, 0);
        return (
          <section className="bank" key={bank} aria-label={bank}>
            <div className="bank-head"><span>{bank}</span>{accounts.length > 1 && <span className={total < 0 ? "neg" : ""}>{formatCents(total)}</span>}</div>
            <ul className="rows">
              {accounts.map(([id, a], i) => {
                const pb = pbs[i];
                const card = core.creditOutstanding(id, month, false);
                return (
                  <li key={id}>
                    <span className="what"><b>{a.name as string}{id === main && <em className="badge">principal</em>}</b>
                      <small>{phase === "future" ? "Al cierre del mes" : `${phase === "current" ? "Hoy" : "Al cierre"} ${formatCents(core.realBalance(id, month))}`}{card ? `, tarjeta ${formatCents(-card)}` : ""}</small></span>
                    <span className={`amt ${pb < 0 ? "neg" : ""}`}>{formatCents(pb)}<small>previsto</small></span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Trend month={month} />

      {editing && editing.sheet && (
        <AmountSheet title={editing.sheet.title} detail={editing.detail || undefined} cents={editing.cents} maxCents={editing.sheet.maxCents}
                     confirm={editing.sheet.confirm} onClose={() => setEditing(null)}
                     onConfirm={(euros) => done(editing.done!, editing.act!(euros))} />
      )}
    </div>
  );
}

function Budgets({ month, phase, carry, today }: { month: Month; phase: string; carry: number; today: string }) {
  const { core, docs, mainAccountId } = useData();
  const budgets = core!.activeBudgets(month);
  if (!budgets.length) return null;
  const day = Number(today.slice(8, 10));
  const dim = daysInMonth(month);
  return <>
    <h2 className="title-sm">Budgets</h2>
    <div className="rows">
      {budgets.map((b) => {
        const used = core!.rawCategoryExpenses(month, b.accountId).get(b.categoryId as string) ?? 0;
        const pr = core!.monthProjectedResult(b.accountId!, month, b.accountId === mainAccountId ? carry : 0);
        const detail = pr.budget_details.find((d) => d.budget_id === b.id);
        const limit = detail?.presupuesto ?? b.amount;
        const absorbed = detail?.absorbed ?? 0;
        const pct = limit > 0 ? Math.min(1, Math.max(0, used) / limit) : 1;
        const pace = phase === "current" && limit > 0 ? FinanceCore.budgetPace(used, limit, day, dim) : null;
        const over = used > limit;
        const cat = nameOf(docs.categories, b.categoryId, "Sin categoría");
        let text: string;
        if (over) text = `Te has pasado ${formatCents(used - limit)}.`;
        else if (phase === "future") text = `Previsto ${formatCents(limit)}.`;
        else if (pace && used > 0) text = `Quedan ${formatCents(limit - used)}. A este ritmo acabarás en ${formatCents(Math.round(pace.forecast))}${pace.status === "por encima del ritmo" ? ", por encima del budget" : ""}.`;
        else if (pace) text = `Quedan ${formatCents(limit - used)}.`;
        else text = `Quedaron ${formatCents(limit - used)} sin gastar.`;
        return (
          <div className="budget" key={b.id}>
            <div className="top"><b>{cat}{b.accountId !== mainAccountId && <em> en {nameOf(docs.accounts, b.accountId)}</em>}</b>
              <span>{formatCents(used)} <em>de {formatCents(limit)}</em></span></div>
            <div className="meter">
              <i className={`lvl-${budgetLevel(Math.max(0, used), limit)}`} style={{ width: `${pct * 100}%` }} />
              {pace && <u style={{ left: `${pace.elapsed * 100}%` }} title="Hoy" />}
            </div>
            <p>{text}{absorbed > 0 ? ` ${formatCents(absorbed)} de lo que queda cubre el déficit del mes.` : ""}</p>
          </div>
        );
      })}
    </div>
  </>;
}

/** Cierre de los meses alrededor del elegido: real en los cerrados, previsto en el resto. */
function Trend({ month }: { month: Month }) {
  const { core, currentMonth } = useData();
  const { profile } = useAuth();
  const start = profile!.settings.startMonth;
  const months: Month[] = [];
  for (let m = addMonths(currentMonth, -3); m <= addMonths(currentMonth, 6); m = addMonths(m, 1)) if (m >= start) months.push(m);
  const values = months.map((m) => {
    const s = core!.monthSummary(m);
    return m < currentMonth ? s.resultado_real : s.resultado_proyectado;
  });
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <details className="trend">
      <summary>Cómo cierran los meses</summary>
      <div className="rows">
        {months.map((m, i) => (
          <div className={`trend-row ${m === month ? "here" : ""}`} key={m}>
            <span>{monthShort(m)}</span>
            <span><span className={`bar ${values[i] < 0 ? "neg" : ""} ${m >= currentMonth ? "future" : ""}`}
                        style={{ width: `${(Math.abs(values[i]) / max) * 100}%` }} /></span>
            <span className={values[i] < 0 ? "neg" : ""}>{formatCents(values[i])}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------------- histórico del Excel

const HIST_POOL = "hist_excel";

/** Meses con movimientos importados del Excel (source 'history'), o null si no hay. */
function historyRange(movements: Record<string, Raw>): { first: Month; last: Month } | null {
  let first: Month | null = null;
  let last: Month | null = null;
  for (const m of Object.values(movements)) {
    if (m.source !== "history") continue;
    const mo = monthOf(m.date as string);
    if (!first || mo < first) first = mo;
    if (!last || mo > last) last = mo;
  }
  return first && last ? { first, last } : null;
}

/**
 * Un mes anterior a la app: lo que hiciste según tu Excel. El saldo de la cuenta «Excel» al
 * cierre es tu remanente de ese mes; el resultado, lo que cambió en el mes.
 */
function HistoryMonth({ month, first, last, go }: { month: Month; first: Month; last: Month; go: (m: Month) => void }) {
  const { core, docs } = useData();
  const result = core!.monthRealResult(HIST_POOL, month);
  const closing = core!.realBalance(HIST_POOL, month);
  const items = Object.values(docs.movements).filter((m) => m.source === "history" && monthOf(m.date as string) === month);
  const byCat = new Map<string, number>();
  let income = 0;
  for (const m of items) {
    const cents = Math.round((m.amount as number) * 100);
    if (m.type === "income" && m.accountId === HIST_POOL) income += cents;
    if (m.type === "expense" && m.accountId === HIST_POOL) {
      const cat = nameOf(docs.categories, m.categoryId as string, "Sin categoría");
      byCat.set(cat, (byCat.get(cat) ?? 0) + cents);
    }
  }
  const spent = [...byCat.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="page month">
      <ScreenHeader id="mes" />
      <div className="month-switch">
        <button onClick={() => go(addMonths(month, -1))} disabled={month <= first} aria-label="Mes anterior"><IconPrev /></button>
        <h1>{monthLong(month)}<small>Antes de la app, desde tu Excel</small></h1>
        <button onClick={() => go(addMonths(month, 1))} disabled={month >= last} aria-label="Mes siguiente"><IconNext /></button>
      </div>
      <section className="closing" aria-label="Remanente del mes">
        <div className="label">Remanente al cierre</div>
        <div className={`figure ${closing < 0 ? "neg" : ""}`}>{formatCents(closing)}</div>
        <p className="muted small">Resultado del mes {formatCents(result)}. Es el «Total» de costes variables de tu hoja.</p>
      </section>
      <div className="figures">
        <div><span>Ingresos</span><strong>{formatCents(income)}</strong></div>
        <div><span>Gastos</span><strong>{formatCents(spent)}</strong></div>
        <div><span>Movimientos</span><strong>{items.length}</strong></div>
      </div>
      <h2 className="title-sm">Gastos por categoría</h2>
      <ul className="rows">
        {[...byCat].sort((a, b) => b[1] - a[1]).map(([cat, v]) => (
          <li key={cat}><span className="what"><b>{cat}</b></span><span className="amt">{formatCents(v)}</span></li>
        ))}
        {byCat.size === 0 && <li className="empty">Sin gastos este mes.</li>}
      </ul>
      <p className="muted small">El detalle está en Movimientos. Los ajustes («Ajuste del remanente») son cambios que hiciste a mano en la hoja.</p>
    </div>
  );
}
