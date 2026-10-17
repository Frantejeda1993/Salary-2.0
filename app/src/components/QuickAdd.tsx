/**
 * Alta rápida: importe, comercio y guardar. Todo lo demás llega preseleccionado
 * (medio de pago y categoría de la última vez, fecha de hoy) y se puede cambiar.
 */
import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../data";
import { addMovement, type NewMovement } from "../lib/actions";
import { parseAmount, formatEuros } from "../lib/money";
import {
  cardChargeMonth, findDuplicate, findMerchant, lastPayWith, merchantHistory, suggestMerchants, todayIn,
  type CardLike, type RawCol,
} from "../lib/quickadd";
import { monthLong, sortedLive } from "../lib/format";
import { useUI, type QuickAddPrefill } from "../ui";
import Sheet from "./Sheet";

type Kind = "expense" | "income" | "transfer";
const KIND_LABEL: Record<Kind, string> = { expense: "Gasto", income: "Ingreso", transfer: "Transferencia" };

export default function QuickAdd({ prefill }: { prefill: QuickAddPrefill }) {
  const { user, profile } = useAuth();
  const { docs, mainAccountId } = useData();
  const { closeQuickAdd, toast } = useUI();
  const tz = profile?.settings?.timezone || "Europe/Madrid";
  const movements = docs.movements as RawCol;

  const accounts = sortedLive(docs.accounts);
  const cards = sortedLive(docs.cards);
  const categories = sortedLive(docs.categories);
  const history = useMemo(() => merchantHistory(movements), [movements]);
  const defaultPay = useMemo(() => {
    const last = lastPayWith(movements);
    const ok = (p: string | null) => p && (p.startsWith("card:") ? cards.some(([id]) => `card:${id}` === p) : accounts.some(([id]) => `acc:${id}` === p));
    return ok(last) ? last! : mainAccountId ? `acc:${mainAccountId}` : accounts[0] ? `acc:${accounts[0][0]}` : "";
  }, [movements, cards, accounts, mainAccountId]);

  const [kind, setKind] = useState<Kind>("expense");
  const [amount, setAmount] = useState(prefill.amount ?? "");
  const [desc, setDesc] = useState(prefill.description ?? "");
  const [date, setDate] = useState(prefill.date ?? todayIn(tz));
  const known = findMerchant(history, prefill.description ?? "");
  const [payWith, setPayWith] = useState(prefill.payWith ?? known?.payWith ?? defaultPay);
  const [payTouched, setPayTouched] = useState(!!prefill.payWith);
  const [categoryId, setCategoryId] = useState<string | null>(known?.categoryId ?? null);
  const [catTouched, setCatTouched] = useState(false);
  const [fromAcc, setFromAcc] = useState(mainAccountId ?? accounts[0]?.[0] ?? "");
  const [toAcc, setToAcc] = useState(accounts.find(([id]) => id !== mainAccountId)?.[0] ?? "");
  const [isLoan, setIsLoan] = useState(false);
  const [reserve, setReserve] = useState<"purchase" | "charge" | null>(null);
  const [tried, setTried] = useState(false);

  const value = parseAmount(amount);
  const cardId = payWith.startsWith("card:") ? payWith.slice(5) : null;
  const card = cardId ? (docs.cards[cardId] as CardLike | undefined) : undefined;
  const chargeMonth = card && /^\d{4}-\d{2}-\d{2}$/.test(date) ? cardChargeMonth(card, date) : null;
  const reserveIn = reserve ?? card?.defaultReserveIn ?? "purchase";
  const suggestions = kind === "expense" ? suggestMerchants(history, desc) : [];
  const duplicate = kind === "expense" && value ? findDuplicate(movements, value, desc, date) : null;

  function changeKind(k: Kind) {
    setKind(k);
    // Los ingresos van a una cuenta, no a una tarjeta.
    if (k === "income" && card) setPayWith(`acc:${card.accountId as string}`);
  }

  function pickMerchant(name: string) {
    setDesc(name);
    const m = findMerchant(history, name);
    if (!m) return;
    if (!catTouched) setCategoryId(m.categoryId && docs.categories[m.categoryId] ? m.categoryId : null);
    if (!payTouched) setPayWith(m.payWith);
  }

  const errors: string[] = [];
  const amountOk = !!(value && value > 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Elige una fecha.");
  if (kind !== "transfer" && !payWith) errors.push("Elige la cuenta.");
  if (kind === "transfer" && (!fromAcc || !toAcc || fromAcc === toAcc)) errors.push("Elige dos cuentas distintas.");

  function save() {
    setTried(true);
    if (!amountOk) { document.querySelector<HTMLInputElement>(".big-amount input")?.focus(); return; }
    if (errors.length || !user || !value) return;
    let m: NewMovement;
    const description = desc.trim();
    if (kind === "expense") {
      const accountId = card ? (card.accountId as string) : payWith.slice(4);
      m = { type: "expense", date, amount: value, description, categoryId, accountId };
      if (card && cardId && chargeMonth) m.card = { cardId, chargeMonth, reserveIn };
    } else if (kind === "income") {
      m = { type: "income", date, amount: value, description, categoryId, accountId: payWith.startsWith("acc:") ? payWith.slice(4) : (card?.accountId as string) };
    } else {
      m = {
        type: "transfer", date, amount: value, description, accountId: fromAcc, toAccountId: toAcc,
        transferKind: isLoan ? "loan" : "normal", ...(isLoan ? { loan: { status: "pending" as const, outstanding: value } } : {}),
      };
    }
    const { undo } = addMovement(user.uid, m, prefill.source ?? "app");
    closeQuickAdd();
    const what = kind === "expense" ? "Gasto" : kind === "income" ? "Ingreso" : isLoan ? "Préstamo" : "Transferencia";
    toast(`${what} de ${formatEuros(value)} guardado`, undo);
  }

  const accountOptions = accounts.map(([id, a]) => <option key={id} value={id}>{a.name as string}</option>);

  return (
    <Sheet title={prefill.source === "shortcut" ? "Confirma el gasto" : `Nuevo ${KIND_LABEL[kind].toLowerCase()}`} onClose={closeQuickAdd}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <div className="segmented" role="group" aria-label="Tipo de movimiento">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button type="button" key={k} aria-pressed={kind === k} onClick={() => changeKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>

        <label className="big-amount">
          <input autoFocus inputMode="decimal" enterKeyHint="next" autoComplete="off" placeholder="0,00" aria-label="Importe"
                 value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: `${Math.max(4, amount.length + 0.5)}ch` }} aria-invalid={tried && !value} aria-describedby={tried && !value ? "amount-error" : undefined} />
          <span>€</span>
        </label>
        {tried && !(value && value > 0) && <p className="field-error" id="amount-error">Escribe un importe mayor que 0.</p>}
        {prefill.notes?.map((n) => <p className="warn" key={n}>{n}</p>)}

        <label className="field"><span>{kind === "expense" ? "Comercio o concepto" : "Concepto"}</span>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => pickMerchant(desc)}
                 autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" placeholder={kind === "expense" ? "Mercadona" : ""} />
        </label>
        {suggestions.length > 0 && (
          <div className="chips" aria-label="Sugerencias">
            {suggestions.map((s) => <button type="button" className="chip" key={s.name} onClick={() => pickMerchant(s.name)}>{s.name}</button>)}
          </div>
        )}

        {kind !== "transfer" && <>
          <label className="field"><span>{kind === "expense" ? "Pagar con" : "Cuenta"}</span>
            <select className="input" value={payWith} onChange={(e) => { setPayWith(e.target.value); setPayTouched(true); }}>
              <optgroup label="Cuentas">
                {accounts.map(([id, a]) => <option key={id} value={`acc:${id}`}>{a.name as string}</option>)}
              </optgroup>
              {kind === "expense" && cards.length > 0 && (
                <optgroup label="Tarjetas de crédito">
                  {cards.map(([id, c]) => <option key={id} value={`card:${id}`}>{c.name as string}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {kind === "expense" && card && chargeMonth && (
            <div className="field"><span>Se cobra en {monthLong(chargeMonth)}. ¿En qué mes lo descuentas?</span>
              <div className="segmented" role="group">
                <button type="button" aria-pressed={reserveIn === "purchase"} onClick={() => setReserve("purchase")}>Al comprar</button>
                <button type="button" aria-pressed={reserveIn === "charge"} onClick={() => setReserve("charge")}>Al cobrarse</button>
              </div>
            </div>
          )}
          <div className="field"><span>Categoría</span>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={categoryId === null} onClick={() => { setCategoryId(null); setCatTouched(true); }}>Sin categoría</button>
              {categories.map(([id, c]) => (
                <button type="button" className="chip" key={id} aria-pressed={categoryId === id}
                        onClick={() => { setCategoryId(id); setCatTouched(true); }}>{c.name as string}</button>
              ))}
            </div>
          </div>
        </>}

        {kind === "transfer" && <>
          <label className="field"><span>Desde</span><select className="input" value={fromAcc} onChange={(e) => setFromAcc(e.target.value)}>{accountOptions}</select></label>
          <label className="field"><span>Hacia</span><select className="input" value={toAcc} onChange={(e) => setToAcc(e.target.value)}>{accountOptions}</select></label>
          <label className="check"><input type="checkbox" checked={isLoan} onChange={(e) => setIsLoan(e.target.checked)} />
            Es un préstamo (queda pendiente de devolver)</label>
        </>}

        <label className="field"><span>Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>

        {duplicate && <p className="warn">Ya tienes un gasto de {formatEuros(value!)} en «{desc.trim()}» ese día. Guárdalo solo si es otro distinto.</p>}
        {tried && errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

        <button className="btn primary wide save" type="submit">Guardar {KIND_LABEL[kind].toLowerCase()}</button>
      </form>
    </Sheet>
  );
}
