/**
 * Guía para que el iPhone abra el alta rápida ya rellenada al pagar con Apple Pay.
 * iOS no deja que una web cree automatizaciones: la guía da los pasos y el texto exacto
 * de cada tarjeta y cuenta, listo para copiar.
 */
import { useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../data";
import { patchItem } from "../lib/actions";
import { useUI } from "../ui";
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

/**
 * Atajo genérico compartido por iCloud. Vacío: la guía explica cómo crearlo. Debe mandar
 * #/nuevo?wallet=<tarjeta>&importe=<importe>&comercio=<comercio> (cada valor codificado).
 */
export const SHARED_SHORTCUT_URL = "";

export default function ShortcutGuide() {
  const { docs } = useData();
  const base = appBase();
  const generic = `${base}#/nuevo?wallet=`;
  const cards = sortedLive(docs.cards);
  const accounts = sortedLive(docs.accounts);
  const targets: { key: string; kind: "tarjeta" | "cuenta"; name: string; note: string }[] = [
    ...cards.map(([id, c]) => ({ key: `c${id}`, kind: "tarjeta" as const, name: c.name as string, note: "Tarjeta de crédito: se cobra con la tarjeta" })),
    ...accounts.map(([id, a]) => ({ key: `a${id}`, kind: "cuenta" as const, name: a.name as string, note: "Débito: sale de la cuenta ese día" })),
  ];
  const [pick, setPick] = useState(targets[0]?.key ?? "");
  const t = targets.find((x) => x.key === pick) ?? targets[0];
  const prefix = t ? shortcutPrefix(base, t.kind, t.name) : "";
  const test = `${generic}Tarjeta%20de%20prueba&importe=1%2C00&comercio=Prueba%20del%20atajo`;

  return (
    <div className="guide">
      <p>Al pagar con Apple Pay, el iPhone abre la app con el importe, el comercio y la tarjeta ya puestos. Tú eliges la categoría y guardas.</p>
      <ul className="guide-limits">
        <li>Solo con Apple Pay desde el iPhone: la tarjeta física no avisa al teléfono.</li>
        <li>Se abre en Safari, no en el icono de la app (iOS no lo permite). Entra una vez con Google también en Safari.</li>
        <li>Nada se guarda solo: siempre confirmas tú.</li>
      </ul>

      <h4 className="guide-h">Una automatización para todas tus tarjetas</h4>
      <ol className="guide-steps">
        {SHARED_SHORTCUT_URL ? (
          <li>Instala el atajo <a href={SHARED_SHORTCUT_URL} target="_blank" rel="noreferrer"><b>Salary: apuntar pago</b></a> y pulsa «Añadir atajo».</li>
        ) : (
          <li>Crea un atajo llamado <b>Salary: apuntar pago</b> que reciba la transacción y tenga:
            <b> Codificar URL</b> de la Tarjeta, del Importe y del Comercio; un <b>Texto</b> que empiece por
            <span className="guide-code"><code>{generic}</code><Copy text={generic} label="Copiar" /></span>
            seguido de la Tarjeta codificada, <code>&amp;importe=</code>, el Importe codificado, <code>&amp;comercio=</code> y el Comercio codificado;
            y <b>Abrir URLs</b> con ese texto.</li>
        )}
        <li>En Atajos, pestaña <b>Automatización</b>, toca <b>+</b> y elige <b>Transacción</b> (puede estar dentro de Wallet).</li>
        <li>Marca <b>todas</b> tus tarjetas y elige <b>Ejecutar inmediatamente</b>.</li>
        <li>Como acción, <b>Ejecutar atajo</b> → «Salary: apuntar pago», con la <b>Entrada del atajo</b> como entrada.</li>
      </ol>
      <p className="muted small">La primera vez que pagues con cada tarjeta, la app te pedirá con qué pagaste y lo recordará. Lo aprendido se ve (y se olvida) en cada cuenta y tarjeta, en Ajustes.</p>
      <a className="btn wide" href={test}>Probar con 1,00 € (no guarda nada)</a>

      <details className="secondary">
        <summary>Hacerlo a mano, una automatización por tarjeta</summary>
        <label className="field"><span>¿Para qué tarjeta o cuenta?</span>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {targets.map((x) => <option key={x.key} value={x.key}>{x.name} ({x.kind === "tarjeta" ? "crédito" : "débito"})</option>)}
          </select>
          {t && <small className="hint-text">{t.note}.</small>}
        </label>
        <ol className="guide-steps">
          <li>Automatización <b>Transacción</b> con solo esa tarjeta de Wallet, <b>Ejecutar inmediatamente</b>.</li>
          <li><b>Codificar URL</b> del Importe y otra del Comercio.</li>
          <li><b>Texto</b>: pega
            <span className="guide-code"><code>{prefix}</code><Copy text={prefix} label="Copiar" /></span>
            inserta el Importe codificado, escribe <code>&amp;comercio=</code> e inserta el Comercio codificado.</li>
          <li><b>Abrir URLs</b> con ese texto.</li>
        </ol>
        {t && <a className="btn wide" href={`${prefix}1%2C00&comercio=Prueba%20del%20atajo`}>Probar esta con 1,00 €</a>}
      </details>
    </div>
  );
}

/** Nombres de Wallet que la app ya relaciona con esta tarjeta o cuenta (atajo genérico). */
export function WalletNames({ coll, id }: { coll: "cards" | "accounts"; id: string }) {
  const { user } = useAuth();
  const { docs } = useData();
  const { toast } = useUI();
  const doc = (coll === "cards" ? docs.cards : docs.accounts)[id] as Record<string, unknown> | undefined;
  const names = (doc?.walletNames as string[] | undefined) ?? [];
  if (!doc || !names.length || !user) return null;
  return (
    <div className="wallet-names">
      <span>En Wallet se llama</span>
      <ul>{names.map((n) => (
        <li key={n}><b>{n}</b><button className="link danger" onClick={() =>
          toast(`«${n}» olvidado`, patchItem(user.uid, coll, id, { walletNames: names.filter((x) => x !== n) }, doc))}>Olvidar</button></li>
      ))}</ul>
    </div>
  );
}
