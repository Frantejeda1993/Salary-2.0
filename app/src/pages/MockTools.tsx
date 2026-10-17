import { writeBatch } from "firebase/firestore";
import { useAuth } from "../auth";
import { db } from "../firebase";
import { USER_COLLECTIONS, userDoc, userItem } from "../lib/paths";

/** Solo en `npm run dev:mock`: cargar datos sintéticos (nunca reales) para probar la app. */
export default function MockTools() {
  const { user } = useAuth();
  async function loadDemo() {
    const ref = (await import("../../../fixtures/reference/synthetic-002.json")).default as {
      dataset: { profile: { settings: Record<string, unknown> }; docs: Record<string, Record<string, Record<string, unknown>>> };
    };
    const batch = writeBatch(db);
    for (const c of USER_COLLECTIONS) {
      for (const [id, d] of Object.entries(ref.dataset.docs[c] ?? {})) batch.set(userItem(user!.uid, c, id), d);
    }
    batch.set(userDoc(user!.uid), {
      displayName: "Demo", onboardingDone: true,
      settings: { ...ref.dataset.profile.settings, timezone: "Europe/Madrid", currency: "EUR", locale: "es-ES" },
    });
    await batch.commit();
  }
  async function reset() {
    const m = await import("firebase/firestore") as unknown as { __resetMockStore?: () => void };
    m.__resetMockStore?.();
    location.reload();
  }
  return (
    <section className="card mock">
      <h2 className="title-sm">Modo prueba</h2>
      <p className="muted small">Firebase simulado. Datos solo en este navegador.</p>
      <button className="btn wide" onClick={loadDemo}>Cargar datos de ejemplo (sintéticos)</button>
      <button className="btn wide ghost" onClick={reset}>Borrar todo</button>
    </section>
  );
}
