/**
 * Datos del usuario en tiempo real (con caché offline) y el motor de cálculo listo para usar.
 * Toda la app lee de aquí: así cada pantalla ve las mismas cifras.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onSnapshot } from "firebase/firestore";
import {
  CURRENT_OPTIONS, FinanceCore, currentMonthInTimeZone, fromDataset, type Dataset, type Docs, type Month,
} from "@salary/engine";
import { useAuth } from "./auth";
import { USER_COLLECTIONS, userCol, type UserCollection } from "./lib/paths";

type RawDocs = Record<UserCollection, Record<string, Record<string, unknown>>>;

interface DataValue {
  ready: boolean;
  docs: RawDocs;
  currentMonth: Month;
  /** Motor corregido (Fase 4b), en céntimos enteros. */
  core: FinanceCore | null;
  mainAccountId: string | null;
}
const DataContext = createContext<DataValue | null>(null);

const empty = (): RawDocs => Object.fromEntries(USER_COLLECTIONS.map((c) => [c, {}])) as RawDocs;

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, profile, status } = useAuth();
  const [docs, setDocs] = useState<RawDocs>(empty);
  const [loaded, setLoaded] = useState<Set<UserCollection>>(new Set());

  useEffect(() => {
    if (!user || status !== "ready") return undefined;
    setDocs(empty());
    setLoaded(new Set());
    const unsubs = USER_COLLECTIONS.map((c) =>
      onSnapshot(userCol(user.uid, c), (snap) => {
        setDocs((prev) => ({ ...prev, [c]: Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>])) }));
        setLoaded((prev) => new Set(prev).add(c));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [user, status]);

  const tz = profile?.settings?.timezone || "Europe/Madrid";
  // Se recalcula al cambiar de mes aunque la app siga abierta (comprobación cada minuto).
  const [currentMonth, setCurrentMonth] = useState<Month>(() => currentMonthInTimeZone(tz));
  useEffect(() => {
    setCurrentMonth(currentMonthInTimeZone(tz));
    const t = setInterval(() => setCurrentMonth(currentMonthInTimeZone(tz)), 60_000);
    return () => clearInterval(t);
  }, [tz]);

  const ready = loaded.size === USER_COLLECTIONS.length;
  const mainAccountId = profile?.settings?.mainAccountId ?? null;

  const core = useMemo(() => {
    if (!ready || !profile) return null;
    const dataset: Dataset = { profile: { settings: profile.settings }, docs: docs as unknown as Docs };
    return new FinanceCore(fromDataset(dataset, { cents: true }), currentMonth, profile.settings.startMonth, CURRENT_OPTIONS);
  }, [ready, docs, profile, currentMonth]);

  return <DataContext.Provider value={{ ready, docs, currentMonth, core, mainAccountId }}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const v = useContext(DataContext);
  if (!v) throw new Error("useData fuera de DataProvider");
  return v;
}
