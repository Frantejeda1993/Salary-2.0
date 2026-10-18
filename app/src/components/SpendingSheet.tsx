/**
 * Gasto por categoría de un mes, en un anillo. Se abre al tocar la cifra grande de Mes.
 * Hasta 6 porciones (las pequeñas se agrupan en «Otras»); la lista de abajo da cada importe
 * y porcentaje, así el color nunca es la única pista. Tocar una porción o una fila la resalta.
 */
import { useState } from "react";
import type { Month } from "@salary/engine";
import { useData } from "../data";
import { monthLong, nameOf } from "../lib/format";
import { formatCents } from "../lib/money";
import { OTHER_KEY, spendingSlices } from "../lib/spending";
import Sheet from "./Sheet";

const R = 80, W = 26, GAP = 2;
const pctText = (x: number) => `${Math.round(x * 100)} %`;

function arc(a0: number, a1: number): string {
  const r0 = R - W;
  const p = (r: number, a: number) => `${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

export default function SpendingSheet({ month, phase, onClose }: { month: Month; phase: "past" | "current"; onClose: () => void }) {
  const { core, docs, mainAccountId } = useData();
  const [scope, setScope] = useState<"main" | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  if (!core) return null;
  const acc = scope === "main" ? mainAccountId : null;
  const raw = core.rawCategoryExpenses(month, acc);
  const fixed = core.fixedExpensesForMonth(month).filter((f) => !acc || f.account_id === acc);
  const fixedPaid = fixed.filter((f) => f.estado === "pagado")
    .map((f) => ({ categoryId: (docs.fixedExpenses[f.id]?.categoryId as string | undefined) ?? null, cents: f.monto_pagado ?? f.monto }));
  const pendingFixed = fixed.filter((f) => f.estado !== "pagado").reduce((t, f) => t + f.monto, 0);
  const { slices, total, hidden } = spendingSlices(raw, fixedPaid, (id) => nameOf(docs.categories, id, "Sin categoría"));

  let a = 0;
  const gap = slices.length > 1 ? GAP / R : 0;
  const arcs = slices.map((s, i) => {
    const span = (s.cents / total) * Math.PI * 2;
    const d = slices.length === 1 ? null : arc(a + gap / 2, a + span - gap / 2);
    a += span;
    return { ...s, i, d };
  });
  const focus = slices.find((s) => s.key === sel);

  return (
    <Sheet title={phase === "current" ? `Gastado en ${monthLong(month)}, hasta hoy` : `Gastado en ${monthLong(month)}`} onClose={onClose}>
      <div className="segmented" role="group" aria-label="Cuentas">
        <button aria-pressed={scope === "all"} onClick={() => { setScope("all"); setSel(null); }}>Todas las cuentas</button>
        <button aria-pressed={scope === "main"} onClick={() => { setScope("main"); setSel(null); }}>Cuenta principal</button>
      </div>
      {total === 0 ? <p className="placeholder">Sin gastos en {monthLong(month)}.</p> : <>
        <figure className="donut">
          <svg viewBox="0 0 200 200" role="img" aria-label={`Gasto por categoría: ${slices.map((s) => `${s.name} ${formatCents(s.cents)}`).join(", ")}`}>
            {slices.length === 1
              ? <circle cx="100" cy="100" r={R - W / 2} fill="none" strokeWidth={W} className="slice s1" />
              : arcs.map((s) => (
                <path key={s.key} d={s.d!} className={`slice s${s.i + 1} ${sel && sel !== s.key ? "dim" : ""}`}
                      onClick={() => setSel(sel === s.key ? null : s.key)} />
              ))}
            <text x="100" y="94" className="donut-label">{focus ? focus.name : "Total"}</text>
            <text x="100" y="118" className="donut-value">{formatCents(focus ? focus.cents : total)}</text>
          </svg>
        </figure>
        <ul className="rows legend">
          {slices.map((s, i) => (
            <li key={s.key} className={sel && sel !== s.key ? "dim" : ""}>
              <button className="what plain" onClick={() => setSel(sel === s.key ? null : s.key)} aria-pressed={sel === s.key}>
                <b><i className={`sw s${i + 1}`} aria-hidden="true" />{s.name}</b>
                {s.key === OTHER_KEY && <small>{hidden.map((h) => h.name).join(", ")}</small>}
              </button>
              <span className="amt">{formatCents(s.cents)}<small>{pctText(s.cents / total)}</small></span>
            </li>
          ))}
        </ul>
      </>}
      <p className="muted small">
        Gastos apuntados (las compras con tarjeta, en el mes en que las descuentas) y gastos fijos pagados. No incluye transferencias ni préstamos.
        {phase === "current" && pendingFixed > 0 ? ` Faltan ${formatCents(pendingFixed)} de gastos fijos por pagar.` : ""}
      </p>
    </Sheet>
  );
}
