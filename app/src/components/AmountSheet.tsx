import { useState } from "react";
import { formatCents, parseAmount } from "../lib/money";
import Sheet from "./Sheet";

/** Confirmar una acción con un importe editable (pagar un fijo por otro importe, devolver parte de un préstamo…). */
export default function AmountSheet({ title, detail, cents, maxCents, confirm, onConfirm, onClose, zero }: {
  title: string; detail?: string; cents: number; maxCents?: number; confirm: string;
  onConfirm: (euros: number) => void; onClose: () => void;
  /** Permite 0 € con un botón propio (p. ej. «Este mes no hubo gasto») y su explicación. */
  zero?: { label: string; note?: string };
}) {
  const [raw, setRaw] = useState((cents / 100).toFixed(2).replace(".", ","));
  const v = parseAmount(raw);
  const tooBig = v !== null && maxCents !== undefined && Math.round(v * 100) > maxCents;
  const ok = v !== null && (v > 0 || (!!zero && v === 0)) && !tooBig;
  return (
    <Sheet title={title} onClose={onClose}>
      {detail && <p className="muted">{detail}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (ok) { onConfirm(v!); onClose(); } }}>
        <label className="big-amount">
          <input autoFocus inputMode="decimal" autoComplete="off" aria-label="Importe" value={raw}
                 onChange={(e) => setRaw(e.target.value)} style={{ width: `${Math.max(4, raw.length + 0.5)}ch` }} onFocus={(e) => e.target.select()} />
          <span>€</span>
        </label>
        {tooBig && <p className="errors">Como mucho {formatCents(maxCents!)}.</p>}
        <button className="btn primary wide save" type="submit" disabled={!ok}>{confirm}</button>
      </form>
      {zero && <>
        <button className="btn wide ghost zero-btn" onClick={() => { onConfirm(0); onClose(); }}>{zero.label}</button>
        {zero.note && <p className="muted small">{zero.note}</p>}
      </>}
    </Sheet>
  );
}
