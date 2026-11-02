/**
 * Gastos compartidos (fase 8c): la sección de Mes, la ficha de cada gasto, saldar y el
 * selector de reparto que usa también el alta rápida. Cifras del motor y de lib/shared.ts.
 */
import { useState, type ReactElement } from "react";
import { addMonths, monthOf, type Month } from "@salary/engine";
import { useAuth } from "../auth";
import { useData } from "../data";
import { type NewExpense } from "../lib/actions";
import { dayShort, monthName, sortedLive } from "../lib/format";
import { formatCents, parseAmount } from "../lib/money";
import { partnerOf } from "../lib/pairs";
import { cardChargeMonth, type CardLike } from "../lib/quickadd";
import {
  balanceText, currentBalance, incomesFor, itemView, monthView, myCategory, splitCents, splitError, splitLabel,
  type SharedContext, type SharedItemView, type Split,
} from "../lib/shared";
import {
  cancelSettlement, confirmSettlement, deleteShared, linkPayment, rejectSettlement, sendSettlement, setMyCategory, updateShared,
} from "../lib/sharedData";
import { useUI } from "../ui";
import AmountSheet from "./AmountSheet";
import Fold from "./Fold";
import Sheet from "./Sheet";

type Raw = Record<string, unknown>;

/** Nombre corto de mi pareja (el de la pareja activa). */
export function usePartner(): { uid: string; name: string } | null {
  const { pairs, shared } = useData();
  const { user } = useAuth();
  if (!shared || !pairs.active || !user) return null;
  const p = partnerOf(pairs.active, user.uid);
  return { uid: p.uid!, name: (p.name || "tu pareja").split(" ")[0] };
}

// ------------------------------------------------------------------------- reparto

/** Elegir quién pagó y cómo se reparte, con la vista previa de cada parte. */
export function SplitFields({ ctx, partner, amountCents, date, paidBy, setPaidBy, split, setSplit }: {
  ctx: SharedContext; partner: { uid: string; name: string }; amountCents: number | null; date: string;
  paidBy: string; setPaidBy: (u: string) => void; split: Split; setSplit: (s: Split) => void;
}) {
  const me = ctx.me;
  const [pctRaw, setPctRaw] = useState(String(split.percent?.[me] ?? 50));
  const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : ctx.currentMonth;
  const err = splitError(split, [me, partner.uid]);
  const preview = amountCents && amountCents > 0 && !err
    ? splitCents(amountCents, split, [me, partner.uid], paidBy, incomesFor(ctx, month), month < ctx.currentMonth) : null;
  function setPct(raw: string) {
    setPctRaw(raw);
    const v = parseAmount(raw);
    const mine = v === null ? NaN : v;
    setSplit({ mode: "percent", percent: { [me]: mine, [partner.uid]: Math.round((100 - mine) * 100) / 100 } });
  }
  return (
    <section className="shared-fields" aria-label="Reparto del gasto compartido">
      <div className="field"><span>¿Quién pagó?</span>
        <div className="segmented" role="group">
          <button type="button" aria-pressed={paidBy === me} onClick={() => setPaidBy(me)}>Yo</button>
          <button type="button" aria-pressed={paidBy === partner.uid} onClick={() => setPaidBy(partner.uid)}>{partner.name}</button>
        </div>
      </div>
      <div className="field"><span>Reparto</span>
        <div className="segmented" role="group">
          <button type="button" aria-pressed={split.mode === "equal"} onClick={() => setSplit({ mode: "equal" })}>A medias</button>
          <button type="button" aria-pressed={split.mode === "percent"} onClick={() => setPct(pctRaw)}>Porcentaje</button>
          <button type="button" aria-pressed={split.mode === "income"} onClick={() => setSplit({ mode: "income" })}>Por ingresos</button>
        </div>
      </div>
      {split.mode === "percent" && (
        <label className="field"><span>Tu parte (%)</span>
          <input className="input" inputMode="decimal" autoComplete="off" value={pctRaw} onChange={(e) => setPct(e.target.value)} aria-invalid={!!err} /></label>
      )}
      {err && <p className="field-error">{err}</p>}
      {preview && (
        <p className="shared-preview" role="status">
          Tu parte <b>{formatCents(preview.parts[me])}</b> · {partner.name} <b>{formatCents(preview.parts[partner.uid])}</b>
          {split.mode === "income" && <small>{preview.missingIncome
            ? `Aún no hay ingresos de ${monthName(month)} de los dos: a medias hasta tenerlos.`
            : `Según lo cobrado en ${monthName(month)}: puede cambiar hasta que cierre el mes.`}</small>}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------- pagar con

function payOptions(docs: ReturnType<typeof useData>["docs"]) {
  return { accounts: sortedLive(docs.accounts), cards: sortedLive(docs.cards) };
}

/** El movimiento de gasto para «pagar con» una cuenta o tarjeta. */
export function expenseFor(docs: ReturnType<typeof useData>["docs"], payWith: string, x: { date: string; amount: number; description: string; categoryId: string | null }): NewExpense {
  if (payWith.startsWith("card:")) {
    const cardId = payWith.slice(5);
    const card = docs.cards[cardId] as CardLike;
    return { type: "expense", ...x, accountId: card.accountId as string,
      card: { cardId, chargeMonth: cardChargeMonth(card, x.date), reserveIn: card.defaultReserveIn ?? "purchase" } };
  }
  return { type: "expense", ...x, accountId: payWith.slice(4) };
}

function PayWithSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { docs } = useData();
  const { accounts, cards } = payOptions(docs);
  return (
    <label className="field"><span>Pagado con</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Cuentas">{accounts.map(([id, a]) => <option key={id} value={`acc:${id}`}>{a.name as string}</option>)}</optgroup>
        {cards.length > 0 && <optgroup label="Tarjetas de crédito">{cards.map(([id, c]) => <option key={id} value={`card:${id}`}>{c.name as string}</option>)}</optgroup>}
      </select>
    </label>
  );
}

function CategoryChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { docs } = useData();
  return (
    <div className="field"><span>Tu categoría para tu parte</span>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>Sin categoría</button>
        {sortedLive(docs.categories).map(([id, c]) => (
          <button type="button" className="chip" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{c.name as string}</button>
        ))}
      </div>
    </div>
  );
}

/** «Lo pagaste tú»: elegir con qué cuenta o tarjeta, para que tu saldo real lo recoja. */
function LinkPaymentSheet({ ctx, v, partnerName, onClose }: { ctx: SharedContext; v: SharedItemView; partnerName: string; onClose: () => void }) {
  const { user } = useAuth();
  const { docs, mainAccountId } = useData();
  const { toast } = useUI();
  const [payWith, setPayWith] = useState(mainAccountId ? `acc:${mainAccountId}` : "");
  const [cat, setCat] = useState<string | null>(myCategory(ctx, v));
  return (
    <Sheet title="¿Con qué lo pagaste?" onClose={onClose}>
      <p className="muted">{v.doc.createdBy === ctx.me ? "Apuntaste" : `${partnerName} apuntó`} que pagaste {formatCents(v.amount)} en «{v.doc.description || "sin concepto"}» el {dayShort(v.doc.date)}. Elige de dónde salió el dinero.</p>
      <PayWithSelect value={payWith} onChange={setPayWith} />
      <CategoryChips value={cat} onChange={setCat} />
      <button className="btn primary wide save" disabled={!payWith} onClick={() => {
        const mv = expenseFor(docs, payWith, { date: v.doc.date, amount: v.doc.amount, description: v.doc.description, categoryId: cat });
        const undo = linkPayment(user!.uid, ctx.pairId, v.id, mv, cat, v.link);
        onClose();
        toast("Pago registrado", undo);
      }}>Registrar el pago</button>
    </Sheet>
  );
}

// ------------------------------------------------------------------------- ficha de un gasto

function ItemSheet({ ctx, v, partnerName, onClose }: { ctx: SharedContext; v: SharedItemView; partnerName: string; onClose: () => void }) {
  const { user } = useAuth();
  const { docs } = useData();
  const { toast } = useUI();
  const mine = v.doc.createdBy === ctx.me;
  const [amount, setAmount] = useState(v.doc.amount.toFixed(2).replace(".", ","));
  const [desc, setDesc] = useState(v.doc.description);
  const [date, setDate] = useState(v.doc.date);
  const [paidBy, setPaidBy] = useState(v.doc.paidBy);
  const [split, setSplit] = useState<Split>(v.doc.split);
  const [cat, setCat] = useState<string | null>(myCategory(ctx, v));
  const value = parseAmount(amount);
  const partner = { uid: ctx.partner, name: partnerName };
  const err = splitError(split, [ctx.me, ctx.partner]);
  const myMovement = v.paidByMe && !v.needsPayment && v.link?.movementId
    ? { id: v.link.movementId, data: docs.movements[v.link.movementId] as Raw } : undefined;
  const ok = !!value && value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !err;

  function save() {
    if (!user) return;
    if (mine && ok) {
      const changed = value !== v.doc.amount || desc.trim() !== v.doc.description || date !== v.doc.date || paidBy !== v.doc.paidBy
        || JSON.stringify(split) !== JSON.stringify(v.doc.split);
      if (changed) {
        // Si cambia quién pagó, mi movimiento deja de corresponder: se conserva y se avisa en «Por hacer».
        const undo = updateShared(user.uid, ctx.pairId, v.id, v.doc, { amount: value!, description: desc.trim(), date, paidBy, split },
          paidBy === ctx.me ? myMovement : undefined);
        if (cat !== myCategory(ctx, v)) setMyCategory(user.uid, ctx.pairId, v.id, cat, v.link);
        onClose();
        toast("Gasto compartido actualizado", undo);
        return;
      }
    }
    if (cat !== myCategory(ctx, v)) {
      const undo = setMyCategory(user.uid, ctx.pairId, v.id, cat, v.link);
      onClose();
      toast("Categoría guardada", undo);
      return;
    }
    onClose();
  }

  return (
    <Sheet title={v.doc.description || "Gasto compartido"} onClose={onClose}>
      <p className="muted">
        {v.paidByMe ? "Pagaste tú" : `Pagó ${partnerName}`} · {splitLabel(v.split, v.doc.split, ctx.me, ctx.partner)}.
        Tu parte {formatCents(v.mine)}, {partnerName} {formatCents(v.theirs)}.
        {!mine && ` Lo apuntó ${partnerName}: solo ${partnerName} puede cambiarlo.`}
        {v.doc.updatedAt && v.doc.updatedBy && v.doc.updatedBy !== ctx.me && ` Modificado por ${partnerName} el ${dayShort(v.doc.updatedAt.slice(0, 10))}.`}
      </p>
      {mine && <>
        <label className="big-amount">
          <input inputMode="decimal" autoComplete="off" aria-label="Importe" value={amount} onChange={(e) => setAmount(e.target.value)}
                 style={{ width: `${Math.max(4, amount.length + 0.5)}ch` }} />
          <span>€</span>
        </label>
        <label className="field"><span>Concepto</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="field"><span>Fecha</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <SplitFields ctx={ctx} partner={partner} amountCents={value ? Math.round(value * 100) : null} date={date}
                     paidBy={paidBy} setPaidBy={setPaidBy} split={split} setSplit={setSplit} />
        {monthOf(date) < ctx.currentMonth && <p className="warn">Es de un mes cerrado: cambiarlo cambia lo que os debéis y las cifras de {monthName(monthOf(date))} de los dos.</p>}
      </>}
      <CategoryChips value={cat} onChange={setCat} />
      <button className="btn primary wide save" disabled={mine && !ok} onClick={save}>Guardar</button>
      {mine && (
        <button className="btn wide ghost danger-btn" onClick={() => {
          const undo = deleteShared(user!.uid, ctx.pairId, v.id, v.doc, v.link, myMovement);
          onClose();
          toast(myMovement ? "Gasto compartido y tu movimiento borrados" : "Gasto compartido borrado", undo);
        }}>Borrar gasto compartido</button>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------------- tareas en «Por hacer»

export interface SharedTodo { key: string; title: string; detail: string; cents: number; button: string; open: () => void }

/** Lo que te toca hacer por los gastos compartidos (para la lista «Por hacer» de Mes). */
export function useSharedTodos(month: Month): { todos: SharedTodo[]; sheet: ReactElement | null } {
  const { shared } = useData();
  const partner = usePartner();
  const [linking, setLinking] = useState<SharedItemView | null>(null);
  if (!shared || !partner) return { todos: [], sheet: null };
  const todos: SharedTodo[] = [];
  for (const s of shared.shared) {
    if (monthOf(s.date) > month) continue;
    const v = itemView(shared, s);
    if (v.needsPayment) {
      todos.push({
        key: `sh-pay-${v.id}`, title: `${v.doc.description || "Gasto compartido"}: ¿con qué pagaste?`,
        detail: v.doc.createdBy === shared.me ? `Gasto compartido del ${dayShort(v.doc.date)}` : `${partner.name} apuntó que lo pagaste tú, el ${dayShort(v.doc.date)}`,
        cents: v.amount, button: "Elegir", open: () => setLinking(v),
      });
    }
  }
  const sheet = linking ? <LinkPaymentSheet ctx={shared} v={linking} partnerName={partner.name} onClose={() => setLinking(null)} /> : null;
  return { todos, sheet };
}

// ------------------------------------------------------------------------- sección de Mes

export function SharedSection({ month, canAct, today }: { month: Month; canAct: boolean; today: string }) {
  const { user } = useAuth();
  const { shared, mainAccountId, docs } = useData();
  const partner = usePartner();
  const { toast } = useUI();
  const [open, setOpen] = useState<SharedItemView | null>(null);
  const [settling, setSettling] = useState(false);
  if (!shared || !partner || !user) return null;
  const view = monthView(shared, month);
  const now = currentBalance(shared);
  const incoming = view.pending.filter((s) => s.to === shared.me);
  const outgoing = view.pending.filter((s) => s.from === shared.me);
  const fmt = formatCents;
  const name = partner.name;
  const signed = (c: number) => <span className={c > 0 ? "neg" : c < 0 ? "pos" : ""}>{fmt(-c)}</span>;
  if (!view.items.length && !view.carried && !view.settlements.length && !view.pending.length && month !== shared.currentMonth) return null;

  return (
    <Fold className="fold-main shared-fold" title="Gastos compartidos" open={incoming.length > 0}
          total={signed(view.balance)} sub={balanceText(view.balance, name, fmt)}>
      <ul className="rows">
        {view.carried !== 0 && (
          <li><span className="what"><b>Pendiente de {monthName(addMonths(month, -1))}</b>
            <small>{view.carried > 0 ? `Lo que debías a ${name}` : `Lo que te debía ${name}`}</small></span>
            <span className="amt">{signed(view.carried)}</span></li>
        )}
        {view.items.map((v) => (
          <li key={v.id}>
            <button className="what plain" onClick={() => setOpen(v)}>
              <b>{v.doc.description || "Sin concepto"}</b>
              <small>{dayShort(v.doc.date)} · {v.paidByMe ? "pagaste tú" : `pagó ${name}`} {fmt(v.amount)} · {splitLabel(v.split, v.doc.split, shared.me, shared.partner).toLowerCase()}
                {v.doc.updatedBy && v.doc.updatedBy !== shared.me ? ` · modificado por ${name}` : ""}</small>
              {v.amountMismatch !== null && <small className="warn-text">Tu movimiento es de {fmt(v.amountMismatch)}: revisa el importe.</small>}
            </button>
            <span className="amt">{fmt(v.mine)}<small>tu parte</small></span>
          </li>
        ))}
        {view.settlements.map((s) => (
          <li key={s.id}><span className="what"><b>{s.from === shared.me ? `Pagaste a ${name}` : `${name} te pagó`}</b><small>{dayShort(s.date)}</small></span>
            <span className={`amt ${s.from === shared.me ? "" : "pos"}`}>{fmt(Math.round(s.amount * 100))}</span></li>
        ))}
        {!view.items.length && !view.settlements.length && <li className="empty">Sin gastos compartidos en {monthName(month)}. Márcalos al apuntarlos con «+».</li>}
      </ul>
      {view.provisional && <p className="muted small">Hay gastos repartidos según los ingresos de {monthName(month)}: puede cambiar hasta que cierre el mes.</p>}

      {incoming.map((s) => (
        <div className="pair-card" key={s.id} role="group" aria-label="Pago por confirmar">
          <p><b>{name}</b> dice que te pagó <b>{fmt(Math.round(s.amount * 100))}</b> el {dayShort(s.date)}. ¿Lo recibiste?</p>
          <p className="muted small">Al confirmarlo se apunta como entrada en tu cuenta principal.</p>
          <div className="pair-actions">
            <button className="btn primary" disabled={!mainAccountId} onClick={() => { confirmSettlement(user.uid, shared.pairId, s, mainAccountId!, name); toast("Pago confirmado"); }}>Lo recibí</button>
            <button className="btn" onClick={() => { rejectSettlement(shared.pairId, s.id); toast("Pago rechazado"); }}>No lo he recibido</button>
          </div>
        </div>
      ))}
      {outgoing.map((s) => (
        <div className="pair-card" key={s.id}>
          <p>Pagaste {fmt(Math.round(s.amount * 100))} a {name} el {dayShort(s.date)}: falta que lo confirme.</p>
          <p className="muted small">Cuando lo confirme, se apuntará la salida en tu cuenta principal.</p>
          <button className="link danger" onClick={() => { cancelSettlement(shared.pairId, s.id); toast("Pago cancelado"); }}>Cancelar</button>
        </div>
      ))}

      {canAct && now > 0 && !outgoing.length && (
        <button className="btn primary wide" onClick={() => setSettling(true)}>Saldar con {name} ({fmt(now)})</button>
      )}
      {canAct && now < 0 && <p className="muted small">{name} te debe {fmt(-now)}. Cuando te pague, te llegará aquí para confirmarlo.</p>}
      {!docs.accounts[mainAccountId ?? ""] && <p className="warn">Elige una cuenta principal en Ajustes para poder saldar.</p>}

      {open && <ItemSheet ctx={shared} v={open} partnerName={name} onClose={() => setOpen(null)} />}
      {settling && (
        <AmountSheet title={`Pagar a ${name}`} cents={now} maxCents={now} confirm="Enviar pago"
                     detail={`Haz el Bizum o la transferencia y apúntalo aquí. Sale de tu cuenta principal cuando ${name} confirme que lo recibió.`}
                     onClose={() => setSettling(false)}
                     onConfirm={(euros) => { const undo = sendSettlement(shared.pairId, shared.me, shared.partner, euros, today); toast("Pago enviado: falta que lo confirme", undo); }} />
      )}
    </Fold>
  );
}

/** Para Mes: la línea «si se saldan…» incluye lo que te deben por gastos compartidos. */
export function sharedReceivable(core: NonNullable<ReturnType<typeof useData>["core"]>, month: Month, hasShared: boolean): number {
  return hasShared ? core.sharedPosition(month).te_deben : 0;
}
