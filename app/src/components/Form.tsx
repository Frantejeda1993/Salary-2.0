/** Piezas de formulario compartidas por los editores de Plan y Ajustes. */
import type { ReactNode } from "react";
import type { Month } from "@salary/engine";
import { monthLong, sortedLive } from "../lib/format";
import { monthChoices } from "../lib/plan";
import { useData } from "../data";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field"><span>{label}</span>{children}{hint && <small className="hint-text">{hint}</small>}</label>
  );
}

/** Mes «desde»/«hasta». Incluye el valor actual aunque quede fuera del rango. */
export function MonthSelect({ value, onChange, back = 12, ahead = 12, min }: {
  value: Month; onChange: (m: Month) => void; back?: number; ahead?: number; min?: Month;
}) {
  const { currentMonth } = useData();
  const opts = monthChoices(currentMonth, back, ahead).filter((m) => !min || m >= min);
  if (!opts.includes(value)) opts.push(value);
  opts.sort();
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((m) => <option key={m} value={m}>{monthLong(m)}{m === currentMonth ? " (este mes)" : ""}</option>)}
    </select>
  );
}

export function AccountSelect({ value, onChange, include }: { value: string; onChange: (id: string) => void; include?: string | null }) {
  const { docs } = useData();
  const list = sortedLive(docs.accounts);
  if (include && docs.accounts[include] && !list.some(([id]) => id === include)) list.push([include, docs.accounts[include]]);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Elige una cuenta</option>}
      {list.map(([id, a]) => <option key={id} value={id}>{a.name as string}{a.archived ? " (archivada)" : ""}</option>)}
    </select>
  );
}

/** Categoría opcional (solo etiqueta). Incluye la elegida aunque esté archivada. */
export function CategorySelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { docs } = useData();
  const list = sortedLive(docs.categories);
  if (value && docs.categories[value] && !list.some(([id]) => id === value)) list.push([value, docs.categories[value]]);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin categoría</option>
      {list.map(([id, c]) => <option key={id} value={id}>{c.name as string}{c.archived ? " (archivada)" : ""}</option>)}
    </select>
  );
}

/**
 * ¿Un gasto fijo con categoría cuenta dentro del budget de esa categoría? Se pregunta siempre
 * que hay categoría; avisa si no hay budget de esa categoría en la cuenta desde la que se paga.
 */
export function InBudgetChoice({ categoryId, accountId, value, onChange }: {
  categoryId: string; accountId: string | null; value: boolean; onChange: (v: boolean) => void;
}) {
  const { docs, currentMonth } = useData();
  if (!categoryId) return null;
  const cat = (docs.categories[categoryId]?.name as string) ?? "esa categoría";
  const budget = Object.values(docs.budgets).find((b) => b.categoryId === categoryId && b.accountId === accountId
    && String(b.start).slice(0, 7) <= currentMonth && (!b.end || String(b.end).slice(0, 7) >= currentMonth));
  return (
    <div className="field">
      <span>¿Descuenta del budget de {cat}?</span>
      <div className="segmented" role="group" aria-label={`¿Descuenta del budget de ${cat}?`}>
        <button type="button" aria-pressed={value} onClick={() => onChange(true)}>Sí, va dentro</button>
        <button type="button" aria-pressed={!value} onClick={() => onChange(false)}>No, aparte</button>
      </div>
      <small className="hint-text">
        {value
          ? "El importe del fijo se resta de lo disponible en el budget; no se reserva dos veces."
          : "El fijo se reserva aparte y el budget queda entero para los demás gastos."}
        {!budget && " Ahora no hay budget de esta categoría en la cuenta desde la que se paga, así que de momento no cambia nada."}
      </small>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />;
}

/** Bloque plegable dentro de un editor: cada cambio es una acción aparte con su botón. */
export function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="edit-section" open={open}><summary>{title}</summary><div>{children}</div></details>;
}

export const Warn = ({ children }: { children: ReactNode }) => <p className="warn">{children}</p>;
export const Errors = ({ list }: { list: string[] }) => (list.length ? <ul className="errors">{list.map((e) => <li key={e}>{e}</li>)}</ul> : null);
