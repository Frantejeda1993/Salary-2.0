/**
 * Alta rápida: importe, comercio y guardar. Todo lo demás llega preseleccionado
 * (medio de pago y categoría de la última vez, fecha de hoy) y se puede cambiar.
 */
import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../data";
import { addMovement, deleteMovement, patchItem, updateMovement, type NewMovement } from "../lib/actions";
import { parseAmount, formatEuros } from "../lib/money";
import {
  cardChargeMonth, findDuplicate, payWithOf, findMerchant, lastPayWith, merchantHistory, suggestMerchants, todayIn, walletNameMoves,
  type CardLike, type RawCol,
} from "../lib/quickadd";
import { monthLong, sortedLive } from "../lib/format";
import { compareFill, deltaText, fuelCategoriesByUse, fuelHistory, guessFuelCategory, isFuelCategory, parseFuel, suggestedPrice, type FuelInfo } from "../lib/fuel";
import { useUI, type QuickAddPrefill } from "../ui";
import Sheet from "./Sheet";

type Kind = "expense" | "income" | "transfer";
const KIND_LABEL: Record<Kind, string> = { expense: "Gasto", income: "Ingreso", transfer: "Transferencia" };
const KIND_TEXT: Record<string, string> = { normal: "Transferencia", loan: "Préstamo", loanRepayment: "Devolución de préstamo", ownExpenseRefund: "Reembolso de gastos propios" };

const n1 = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Litros, consumo y coste por km de este repostaje, frente a la media de los anteriores. */
function FuelSummary({ cmp, price }: { cmp: ReturnType<typeof compareFill>; price: number }) {
  const lines: { text: string; better: boolean }[] = [];
  if (cmp.lPer100 !== null && cmp.avg.lPer100 !== null) lines.push(deltaText(cmp.lPer100, cmp.avg.lPer100, "l100")!);
  if (cmp.eurPerKm !== null && cmp.avg.eurPerKm !== null) lines.push(deltaText(cmp.eurPerKm, cmp.avg.eurPerKm, "eurkm")!);
  if (cmp.avg.price !== null) lines.push(deltaText(price, cmp.avg.price, "price")!);
  return (
    <div className="fuel-cmp" role="status">
      <p className="fuel-now">
        <b>{n1(cmp.liters)} L</b>
        {cmp.lPer100 !== null && <> · <b>{n1(cmp.lPer100)} L/100 km</b></>}
        {cmp.eurPerKm !== null && <> · {n2(cmp.eurPerKm)} €/km</>}
      </p>
      {lines.length > 0 && (
        <ul>{lines.map((l) => <li key={l.text} className={l.better ? "better" : "worse"}>{l.better ? "▼" : "▲"} {l.text}</li>)}</ul>
      )}
      <small>{cmp.avg.n > 0
        ? `Frente a la media de ${cmp.avg.n === 1 ? "tu último repostaje" : `tus últimos ${cmp.avg.n} repostajes`} (consumo y €/km) y de los últimos precios.`
        : cmp.lPer100 === null ? "Pon los km para ver el consumo." : "Es tu primer repostaje con km: la próxima vez verás la comparación."}
        {cmp.last ? ` Último: ${n1(cmp.last.liters)} L a ${cmp.last.price.toLocaleString("es-ES", { maximumFractionDigits: 3 })} €/L.` : ""}</small>
    </div>
  );
}

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
  // Solo cuentas y tarjetas activas: un comercio aprendido del histórico (cuentas archivadas)
  // no debe llevar el gasto a una cuenta que ya no se usa.
  const livePay = (p: string | null | undefined): string | null =>
    p && (p.startsWith("card:") ? cards.some(([id]) => `card:${id}` === p) : accounts.some(([id]) => `acc:${id}` === p)) ? p : null;
  const defaultPay = useMemo(() => {
    const last = livePay(lastPayWith(movements));
    return last ?? (mainAccountId ? `acc:${mainAccountId}` : accounts[0] ? `acc:${accounts[0][0]}` : "");
  }, [movements, cards, accounts, mainAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ed = prefill.edit?.data;
  const edCard = ed?.card as { cardId: string; chargeMonth: string; reserveIn: "purchase" | "charge" } | undefined;
  const [kind, setKind] = useState<Kind>((ed?.type as Kind) ?? "expense");
  const [amount, setAmount] = useState(ed ? Number(ed.amount).toFixed(2).replace(".", ",") : prefill.amount ?? "");
  const [desc, setDesc] = useState(ed ? String(ed.description ?? "") : prefill.description ?? "");
  const [date, setDate] = useState(ed ? (ed.date as string) : prefill.date ?? todayIn(tz));
  const known = ed ? undefined : findMerchant(history, prefill.description ?? "");
  const [payWith, setPayWith] = useState(ed ? payWithOf(ed) : livePay(prefill.payWith) ?? livePay(known?.payWith) ?? defaultPay);
  const [payTouched, setPayTouched] = useState(!!prefill.payWith || !!ed);
  const fuelCats = useMemo(() => fuelCategoriesByUse(categories.map(([id]) => id).filter((id) => isFuelCategory(id, docs.categories, movements)), movements),
    [categories, docs.categories, movements]);
  const [categoryId, setCategoryId] = useState<string | null>(ed ? ((ed.categoryId as string | null) ?? null)
    : known?.categoryId ?? guessFuelCategory(prefill.description ?? "", fuelCats));
  const edFuel = ed?.fuel as FuelInfo | undefined;
  const [kmRaw, setKmRaw] = useState(edFuel?.km ? String(edFuel.km).replace(".", ",") : "");
  const [priceRaw, setPriceRaw] = useState(edFuel?.pricePerLiter ? String(edFuel.pricePerLiter).replace(".", ",") : "");
  const [priceTouched, setPriceTouched] = useState(!!edFuel);
  const [catTouched, setCatTouched] = useState(!!ed);
  const [fromAcc, setFromAcc] = useState(ed?.type === "transfer" ? (ed.accountId as string) : mainAccountId ?? accounts[0]?.[0] ?? "");
  const [toAcc, setToAcc] = useState(ed?.type === "transfer" ? (ed.toAccountId as string) : accounts.find(([id]) => id !== mainAccountId)?.[0] ?? "");
  const [isLoan, setIsLoan] = useState(ed?.transferKind === "loan");
  const [reserve, setReserve] = useState<"purchase" | "charge" | null>(edCard?.reserveIn ?? null);
  const [tried, setTried] = useState(false);

  const value = parseAmount(amount);
  const cardId = payWith.startsWith("card:") ? payWith.slice(5) : null;
  const card = cardId ? (docs.cards[cardId] as CardLike | undefined) : undefined;
  const keepCharge = edCard && edCard.cardId === cardId && ed?.date === date;
  const chargeMonth = keepCharge ? edCard.chargeMonth : card && /^\d{4}-\d{2}-\d{2}$/.test(date) ? cardChargeMonth(card, date) : null;
  const reserveIn = reserve ?? card?.defaultReserveIn ?? "purchase";
  const suggestions = kind === "expense" ? suggestMerchants(history, desc) : [];
  const duplicateId = kind === "expense" && value ? findDuplicate(movements, value, desc, date) : null;
  const duplicate = duplicateId && duplicateId !== prefill.edit?.id ? duplicateId : null;
  const transferKind = (ed?.transferKind as string | undefined) ?? (isLoan ? "loan" : "normal");
  const loanDoc = ed?.loanId ? (movements[ed.loanId as string] as RawCol[string] | undefined) : undefined;

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
    if (!payTouched) { const p = livePay(m.payWith); if (p) setPayWith(p); }
  }
  // Comercio nuevo con nombre de gasolinera: se propone la categoría de combustible.
  function blurMerchant() {
    pickMerchant(desc);
    if (!catTouched && !findMerchant(history, desc)) { const g = guessFuelCategory(desc, fuelCats); if (g) setCategoryId(g); }
  }

  // Repostaje: con categoría de combustible se piden km y precio por litro y se compara.
  const isFuel = kind === "expense" && fuelCats.includes(categoryId ?? "");
  const fuelHist = useMemo(() => (isFuel ? fuelHistory(movements, prefill.edit?.id) : []), [isFuel, movements, prefill.edit?.id]);
  const lastPrice = isFuel ? suggestedPrice(fuelHist, desc) : null;
  const lastPriceHere = isFuel && fuelHist.some((f) => f.merchant.trim().toLowerCase() === desc.trim().toLowerCase() && desc.trim() !== "");
  const shownPrice = priceTouched || !lastPrice ? priceRaw : String(lastPrice).replace(".", ",");
  const fuel = isFuel ? parseFuel(kmRaw, shownPrice) : null;
  const cmp = isFuel && fuel && fuel !== "invalid" && value ? compareFill(value, fuel.km, fuel.pricePerLiter, fuelHist) : null;

  const errors: string[] = [];
  const amountOk = !!(value && value > 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Elige una fecha.");
  if (kind !== "transfer" && !payWith) errors.push("Elige la cuenta.");
  if (kind === "transfer" && (!fromAcc || !toAcc || fromAcc === toAcc)) errors.push("Elige dos cuentas distintas.");
  if (fuel === "invalid") errors.push("Revisa los km y el precio por litro (o déjalos vacíos).");

  // Atajo genérico: recordar qué tarjeta de Wallet es cada tarjeta o cuenta de la app.
  const walletName = !ed && kind === "expense" ? prefill.walletName : undefined;
  const offerRemember = !!walletName && !!payWith && payWith !== prefill.walletMatch;
  const [remember, setRemember] = useState(true);
  const payName = payWith.startsWith("card:") ? (docs.cards[payWith.slice(5)]?.name as string) : (docs.accounts[payWith.slice(4)]?.name as string);

  // Regla D: un ingreso con la categoría de un budget activo de la cuenta es una devolución.
  const incomeAcc = payWith.startsWith("acc:") ? payWith.slice(4) : (docs.cards[payWith.slice(5)]?.accountId as string | undefined);
  const refundBudget = kind === "income" && !!categoryId && Object.values(docs.budgets).some((b) => b.categoryId === categoryId && b.accountId === incomeAcc
    && String(b.start).slice(0, 7) <= date.slice(0, 7) && (!b.end || String(b.end).slice(0, 7) >= date.slice(0, 7)));

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
      if (fuel && fuel !== "invalid") m.fuel = fuel;
    } else if (kind === "income") {
      m = { type: "income", date, amount: value, description, categoryId, accountId: payWith.startsWith("acc:") ? payWith.slice(4) : (card?.accountId as string) };
    } else if (ed) {
      m = { type: "transfer", date, amount: value, description, accountId: fromAcc, toAccountId: toAcc, transferKind: transferKind as "normal" };
    } else {
      m = {
        type: "transfer", date, amount: value, description, accountId: fromAcc, toAccountId: toAcc,
        transferKind: isLoan ? "loan" : "normal", ...(isLoan ? { loan: { status: "pending" as const, outstanding: value } } : {}),
      };
    }
    if (prefill.edit && ed) {
      const after = m.type === "expense" ? { ...m, card: m.card, fuel: m.fuel ?? null } : m;
      const undo = updateMovement(user.uid, prefill.edit.id, ed, after as unknown as Record<string, unknown>, loanDoc);
      closeQuickAdd();
      toast("Cambios guardados", undo);
      return;
    }
    const { undo } = addMovement(user.uid, m, prefill.source ?? "app");
    if (offerRemember && remember && walletName) {
      for (const [coll, id, names] of walletNameMoves(docs.cards as RawCol, docs.accounts as RawCol, walletName, payWith)) {
        patchItem(user.uid, coll, id, { walletNames: names }, (coll === "cards" ? docs.cards : docs.accounts)[id] as Record<string, unknown>);
      }
    }
    closeQuickAdd();
    const what = kind === "expense" ? "Gasto" : kind === "income" ? "Ingreso" : isLoan ? "Préstamo" : "Transferencia";
    toast(`${what} de ${formatEuros(value)} guardado`, undo);
  }

  // Al editar, una cuenta archivada sigue apareciendo si el movimiento la usa.
  const accountList = [...accounts];
  for (const id of [ed?.accountId, ed?.toAccountId] as (string | undefined)[]) {
    if (id && docs.accounts[id] && !accountList.some(([x]) => x === id)) accountList.push([id, docs.accounts[id]]);
  }
  const accountOptions = accountList.map(([id, a]) => <option key={id} value={id}>{a.name as string}</option>);
  const settled = edCard && Object.values(docs.cardSettlements).find((st) => st.accountId === ed?.accountId && st.chargeMonth === edCard.chargeMonth);
  const settledNote = settled ? <p className="warn">Este cargo de tarjeta ya está saldado ({formatEuros(settled.amount as number)}). Si cambias el importe, en Mes verás el aviso para deshacer el pago y volver a saldarlo.</p> : null;

  return (
    <Sheet title={ed ? `Editar ${KIND_LABEL[kind].toLowerCase()}` : prefill.source === "shortcut" ? "Confirma el gasto" : `Nuevo ${KIND_LABEL[kind].toLowerCase()}`} onClose={closeQuickAdd}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {!ed && <div className="segmented" role="group" aria-label="Tipo de movimiento">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button type="button" key={k} aria-pressed={kind === k} onClick={() => changeKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>}

        <label className="big-amount">
          <input autoFocus inputMode="decimal" enterKeyHint="next" autoComplete="off" placeholder="0,00" aria-label="Importe"
                 value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: `${Math.max(4, amount.length + 0.5)}ch` }} aria-invalid={tried && !value} aria-describedby={tried && !value ? "amount-error" : undefined} />
          <span>€</span>
        </label>
        {tried && !(value && value > 0) && <p className="field-error" id="amount-error">Escribe un importe mayor que 0.</p>}
        {prefill.notes?.map((n) => <p className="warn" key={n}>{n}</p>)}

        <label className="field"><span>{kind === "expense" ? "Comercio o concepto" : "Concepto"}</span>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={blurMerchant}
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
                {accountList.map(([id, a]) => <option key={id} value={`acc:${id}`}>{a.name as string}</option>)}
              </optgroup>
              {kind === "expense" && cards.length > 0 && (
                <optgroup label="Tarjetas de crédito">
                  {cards.map(([id, c]) => <option key={id} value={`card:${id}`}>{c.name as string}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {offerRemember && payName && (
            <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Recordar: «{walletName}» de Wallet es {payName}</label>
          )}
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
            {isFuel && (
              <section className="fuel" aria-label="Repostaje">
                <div className="fuel-grid">
                  <label className="field"><span>Km desde el último repostaje</span>
                    <input className="input" inputMode="decimal" autoComplete="off" placeholder="Opcional" value={kmRaw} onChange={(e) => setKmRaw(e.target.value)} /></label>
                  <label className="field"><span>Precio por litro</span>
                    <input className="input" inputMode="decimal" autoComplete="off" placeholder="1,539" value={shownPrice}
                           onChange={(e) => { setPriceRaw(e.target.value); setPriceTouched(true); }} onFocus={(e) => e.target.select()} /></label>
                </div>
                {!priceTouched && lastPrice && <small className="hint-text">{lastPriceHere ? `Precio de tu último repostaje en ${desc.trim()}` : "Precio de tu último repostaje"}: cámbialo si no coincide.</small>}
                {cmp && fuel && fuel !== "invalid" && <FuelSummary cmp={cmp} price={fuel.pricePerLiter} />}
              </section>
            )}
            {kind === "income" && categoryId && refundBudget && (
              <small className="hint-text">Hay un budget de {docs.categories[categoryId]?.name as string} en esta cuenta: este ingreso cuenta como devolución y resta de lo gastado.</small>
            )}
          </div>
        </>}

        {kind === "transfer" && <>
          <label className="field"><span>Desde</span><select className="input" value={fromAcc} onChange={(e) => setFromAcc(e.target.value)}>{accountOptions}</select></label>
          <label className="field"><span>Hacia</span><select className="input" value={toAcc} onChange={(e) => setToAcc(e.target.value)}>{accountOptions}</select></label>
          {ed ? <p className="muted small">{KIND_TEXT[transferKind] ?? "Transferencia"}{ed.loan ? `. Quedan ${formatEuros((ed.loan as { outstanding: number }).outstanding)} por devolver; si cambias el importe, se conserva lo ya devuelto.` : ""}</p>
            : <label className="check"><input type="checkbox" checked={isLoan} onChange={(e) => setIsLoan(e.target.checked)} />
            Es un préstamo (queda pendiente de devolver)</label>}
        </>}

        <label className="field"><span>Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>

        {duplicate && <p className="warn">Ya tienes un gasto de {formatEuros(value!)} en «{desc.trim()}» ese día. Guárdalo solo si es otro distinto.</p>}
        {tried && errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

        {ed && settledNote}
        <button className="btn primary wide save" type="submit">{ed ? "Guardar cambios" : `Guardar ${KIND_LABEL[kind].toLowerCase()}`}</button>
        {prefill.edit && ed && (
          <button type="button" className="btn wide ghost danger-btn" onClick={() => {
            const undo = deleteMovement(user!.uid, prefill.edit!.id, ed, loanDoc);
            closeQuickAdd();
            toast("Movimiento borrado", undo);
          }}>Borrar movimiento</button>
        )}
      </form>
    </Sheet>
  );
}
