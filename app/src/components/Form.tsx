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

export function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />;
}

/** Bloque plegable dentro de un editor: cada cambio es una acción aparte con su botón. */
export function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="edit-section" open={open}><summary>{title}</summary><div>{children}</div></details>;
}

export const Warn = ({ children }: { children: ReactNode }) => <p className="warn">{children}</p>;
export const Errors = ({ list }: { list: string[] }) => (list.length ? <ul className="errors">{list.map((e) => <li key={e}>{e}</li>)}</ul> : null);
