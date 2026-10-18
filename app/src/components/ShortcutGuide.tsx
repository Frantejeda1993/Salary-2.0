/**
 * Guía para que el iPhone abra el alta rápida ya rellenada al pagar con Apple Pay.
 * iOS no deja que una web cree automatizaciones: la guía da los pasos y el texto exacto
 * de cada tarjeta y cuenta, listo para copiar.
 */
import { useState } from "react";
import { useData } from "../data";
import { sortedLive } from "../lib/format";

export const appBase = () => `${window.location.origin}${window.location.pathname}`;

/** Inicio del texto del atajo para una tarjeta o cuenta; detrás van el importe y el comercio. */
export function shortcutPrefix(base: string, kind: "tarjeta" | "cuenta", name: string): string {
  return `${base}#/nuevo?${kind}=${encodeURIComponent(name).replace(/\*/g, "%2A")}&importe=`;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn small" onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 2000); }).catch(() => undefined);
    }}>{done ? "Copiado" : label}</button>
  );
}

export default function ShortcutGuide() {
  const { docs } = useData();
  const base = appBase();
  const cards = sortedLive(docs.cards);
  const accounts = sortedLive(docs.accounts);
  const targets: { key: string; kind: "tarjeta" | "cuenta"; name: string; note: string }[] = [
    ...cards.map(([id, c]) => ({ key: `c${id}`, kind: "tarjeta" as const, name: c.name as string, note: "Tarjeta de crédito: se cobra con la tarjeta" })),
    ...accounts.map(([id, a]) => ({ key: `a${id}`, kind: "cuenta" as const, name: a.name as string, note: "Débito: sale de la cuenta ese día" })),
  ];
  const [pick, setPick] = useState(targets[0]?.key ?? "");
  const t = targets.find((x) => x.key === pick) ?? targets[0];
  const prefix = t ? shortcutPrefix(base, t.kind, t.name) : "";
  const test = t ? `${prefix}1%2C00&comercio=Prueba%20del%20atajo` : "";

  return (
    <div className="guide">
      <p>Al pagar con Apple Pay, el iPhone puede abrir la app con el importe, el comercio y la tarjeta ya puestos. Tú eliges la categoría y guardas.</p>
      <ul className="guide-limits">
        <li>Solo con Apple Pay desde el iPhone: la tarjeta física no avisa al teléfono.</li>
        <li>Se abre en Safari, no en el icono de la app (iOS no lo permite). Entra una vez con Google también en Safari.</li>
        <li>Nada se guarda solo: siempre confirmas tú.</li>
      </ul>

      <label className="field"><span>¿Para qué tarjeta de Wallet es esta automatización?</span>
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
          {targets.map((x) => <option key={x.key} value={x.key}>{x.name} ({x.kind === "tarjeta" ? "crédito" : "débito"})</option>)}
        </select>
        {t && <small className="hint-text">{t.note}.</small>}
      </label>

      <ol className="guide-steps">
        <li>Abre <b>Atajos</b>, pestaña <b>Automatización</b>, y toca <b>+</b>.</li>
        <li>Elige <b>Transacción</b> (puede aparecer dentro de Wallet), marca solo la tarjeta de Wallet que paga {t?.kind === "tarjeta" ? "con esta tarjeta" : "desde esta cuenta"} y elige <b>Ejecutar inmediatamente</b>.</li>
        <li>Añade <b>Codificar URL</b> con la variable de la transacción → <b>Importe</b>.</li>
        <li>Añade otra <b>Codificar URL</b> con la variable → <b>Comercio</b>.</li>
        <li>Añade <b>Texto</b>. Pega esto:
          <div className="guide-code"><code>{prefix}</code><Copy text={prefix} label="Copiar" /></div>
          justo detrás, sin espacios, inserta el <b>Importe codificado</b> (paso 3); luego escribe
          <div className="guide-code"><code>&amp;comercio=</code><Copy text="&comercio=" label="Copiar" /></div>
          e inserta el <b>Comercio codificado</b> (paso 4).</li>
        <li>Añade <b>Abrir URLs</b> con el Texto del paso 5. Repite con cada tarjeta de Wallet.</li>
      </ol>

      <p className="muted small">Si renombras la tarjeta o la cuenta aquí, cambia también el texto del atajo: la app te avisará si no la encuentra.</p>
      {t && <a className="btn wide" href={test}>Probar con 1,00 € (no guarda nada)</a>}
    </div>
  );
}
