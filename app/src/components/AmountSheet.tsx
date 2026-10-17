import { useState } from "react";
import { formatCents, parseAmount } from "../lib/money";
import Sheet from "./Sheet";

/** Confirmar una acción con un importe editable (pagar un fijo por otro importe, devolver parte de un préstamo…). */
export default function AmountSheet({ title, detail, cents, maxCents, confirm, onConfirm, onClose }: {
  title: string; detail?: string; cents: number; maxCents?: number; confirm: string;
  onConfirm: (euros: number) => void; onClose: () => void;
}) {
  const [raw, setRaw] = useState((cents / 100).toFixed(2).replace(".", ","));
  const v = parseAmount(raw);
  const tooBig = v !== null && maxCents !== undefined && Math.round(v * 100) > maxCents;
  const ok = v !== null && v > 0 && !tooBig;
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
    </Sheet>
  );
}
