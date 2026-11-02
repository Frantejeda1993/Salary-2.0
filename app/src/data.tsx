/**
 * Datos del usuario en tiempo real (con caché offline) y el motor de cálculo listo para usar.
 * Toda la app lee de aquí: así cada pantalla ve las mismas cifras.
 *
 * 8c: también las parejas y sus gastos compartidos, porque cambian las cifras del motor.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onSnapshot } from "firebase/firestore";
import {
  CURRENT_OPTIONS, FinanceCore, currentMonthInTimeZone, fromDataset, type Dataset, type Docs, type Month, type SharedLine,
} from "@salary/engine";
import { useAuth } from "./auth";
import { USER_COLLECTIONS, userCol, type UserCollection } from "./lib/paths";
import { partnerOf, type Pair, type PairState } from "./lib/pairs";
import { usePairs } from "./lib/pairsData";
import { engineLines, incomeDocId, incomeMonthsNeeded, myIncomeCents, type SharedContext, type SharedLink } from "./lib/shared";
import { missingSettlementMovements, publishIncome, usePairsShared, writeSettlementMovements } from "./lib/sharedData";

type RawDocs = Record<UserCollection, Record<string, Record<string, unknown>>>;

export type PairsValue = PairState & { ready: boolean; mine: Pair[] };

interface DataValue {
  ready: boolean;
  docs: RawDocs;
  currentMonth: Month;
  /** Motor corregido (Fase 4b), en céntimos enteros. */
  core: FinanceCore | null;
  mainAccountId: string | null;
  pairs: PairsValue;
  /** Gastos compartidos de cada pareja en la que estoy o estuve (por id de pareja). */
  sharedByPair: Record<string, SharedContext>;
  /** Los de la pareja activa, si la hay. */
  shared: SharedContext | null;
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

  // ---------------------------------------------------------------- parejas y gastos compartidos
  const uid = status === "ready" ? user?.uid : undefined;
  const pairs = usePairs(uid, uid ? user?.email ?? undefined : undefined);
  // Las parejas terminadas siguen contando: sus gastos son parte de tus meses pasados.
  const withShared = useMemo(() => pairs.mine.filter((p) => (p.status === "active" || p.status === "ended") && p.members.length === 2),
    [pairs.mine]);
  const byPair = usePairsShared(withShared);

  const sharedByPair = useMemo(() => {
    const out: Record<string, SharedContext> = {};
    if (!uid) return out;
    for (const p of withShared) {
      const data = byPair[p.id];
      if (!data) continue;
      const links = Object.fromEntries(Object.entries(docs.sharedLinks)
        .filter(([, l]) => l.pairId === p.id)) as unknown as Record<string, SharedLink>;
      out[p.id] = {
        me: uid, partner: partnerOf(p, uid).uid!, pairId: p.id, shared: data.shared, settlements: data.settlements,
        incomes: data.incomes, links, movements: docs.movements, categories: docs.categories, currentMonth,
      };
    }
    return out;
  }, [uid, withShared, byPair, docs.sharedLinks, docs.movements, docs.categories, currentMonth]);

  // Los gastos compartidos se esperan solo en la primera carga: si luego aparece una pareja nueva,
  // la app no vuelve a «Cargando» (remontaría la pantalla); sus gastos llegan un instante después.
  const sharedReady = pairs.ready && withShared.every((p) => byPair[p.id]?.ready);
  const baseReady = loaded.size === USER_COLLECTIONS.length;
  const [sharedLoadedOnce, setSharedLoadedOnce] = useState(false);
  useEffect(() => { if (baseReady && sharedReady) setSharedLoadedOnce(true); }, [baseReady, sharedReady]);
  useEffect(() => { setSharedLoadedOnce(false); }, [uid]);
  const ready = baseReady && (sharedReady || sharedLoadedOnce);
  const mainAccountId = profile?.settings?.mainAccountId ?? null;

  const lines: SharedLine[] = useMemo(() => Object.values(sharedByPair).flatMap(engineLines), [sharedByPair]);

  const core = useMemo(() => {
    if (!ready || !profile) return null;
    const dataset: Dataset = { profile: { settings: profile.settings }, docs: docs as unknown as Docs, ...(lines.length ? { shared: lines } : {}) };
    return new FinanceCore(fromDataset(dataset, { cents: true }), currentMonth, profile.settings.startMonth, CURRENT_OPTIONS);
  }, [ready, docs, profile, currentMonth, lines]);

  // Pagos confirmados que faltan en mis movimientos: se apuntan solos (ids fijos, no se duplican).
  const missing = useMemo(() => {
    if (!ready || !uid) return [];
    return withShared.flatMap((p) => missingSettlementMovements(uid, byPair[p.id]?.settlements ?? [], docs.movements, mainAccountId, partnerOf(p, uid).name));
  }, [ready, uid, withShared, byPair, docs.movements, mainAccountId]);
  const missingKey = missing.map((m) => m.id).join(",");
  useEffect(() => { if (uid && missing.length) writeSettlementMovements(uid, missing); }, [missingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reparto por ingresos: publico mi total de los meses que lo necesitan (solo el total).
  const active = pairs.active && pairs.active.members.length === 2 ? sharedByPair[pairs.active.id] ?? null : null;
  const incomeWrites = useMemo(() => {
    if (!core || !active || !uid) return [];
    return incomeMonthsNeeded(active.shared).flatMap((m) => {
      const total = myIncomeCents(core, m) / 100;
      const prev = active.incomes[incomeDocId(uid, m)];
      return prev && prev.total === total ? [] : [{ month: m, total }];
    });
  }, [core, active, uid]);
  const incomeKey = incomeWrites.map((w) => `${w.month}:${w.total}`).join(",");
  useEffect(() => {
    if (!uid || !active) return;
    for (const w of incomeWrites) publishIncome(uid, active.pairId, w.month, w.total);
  }, [incomeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DataContext.Provider value={{ ready, docs, currentMonth, core, mainAccountId, pairs, sharedByPair, shared: active }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataValue {
  const v = useContext(DataContext);
  if (!v) throw new Error("useData fuera de DataProvider");
  return v;
}
