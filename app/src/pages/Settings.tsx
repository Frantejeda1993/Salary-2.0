import { lazy, Suspense, useState } from "react";
import { setDoc } from "firebase/firestore";
import { useAuth } from "../auth";
import { userDoc } from "../lib/paths";

// Herramientas del modo prueba: con esta condición literal, Vite elimina el módulo
// (y los datos sintéticos que carga) de la versión publicada.
const MockTools = import.meta.env.VITE_MOCK === "1" ? lazy(() => import("./MockTools")) : null;

const ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone")
  ?? ["Europe/Madrid", "Europe/Berlin", "Europe/London", "America/New_York"];

export default function Settings() {
  const { user, profile, signOut } = useAuth();
  const [copied, setCopied] = useState(false);
  const tz = profile?.settings?.timezone ?? "Europe/Madrid";

  async function changeTz(timezone: string) {
    await setDoc(userDoc(user!.uid), { settings: { ...profile!.settings, timezone } }, { merge: true });
  }

  return (
    <div className="page">
      <h1 className="title-lg">Ajustes</h1>
      <section className="card">
        <p><strong>{user?.displayName}</strong><br /><span className="muted">{user?.email}</span></p>
        <label className="field"><span>Zona horaria (decide cuándo empieza cada mes)</span>
          <select value={tz} onChange={(e) => changeTz(e.target.value)}>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select></label>
        <div className="field"><span>Tu identificador (uid) — lo necesitarás para la migración</span>
          <div className="uid">
            <code>{user?.uid}</code>
            <button className="btn small" onClick={() => { navigator.clipboard?.writeText(user!.uid); setCopied(true); }}>{copied ? "Copiado" : "Copiar"}</button>
          </div>
        </div>
        <button className="btn wide" onClick={signOut}>Cerrar sesión</button>
      </section>
      {MockTools && <Suspense fallback={null}><MockTools /></Suspense>}
      <p className="muted small">Salary 2.0 · {import.meta.env.MODE}</p>
    </div>
  );
}

