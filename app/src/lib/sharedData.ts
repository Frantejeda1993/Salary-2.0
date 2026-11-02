/**
 * Firestore de los gastos compartidos (fase 8c). Las reglas validan cada escritura.
 * Como el resto de la app, las escrituras no se esperan: con la caché offline se aplican al
 * instante y se suben con la red. Cada acción devuelve cómo deshacerla.
 */
import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { fireWrite, type NewExpense, type Undo } from "./actions";
import { userItem } from "./paths";
import type { Pair } from "./pairs";
import { incomeDocId, type IncomeDoc, type SettlementDoc, type SharedDoc, type SharedLink, type WithId } from "./shared";

const now = () => new Date().toISOString();
const sharedRef = (pairId: string, id?: string) => (id ? doc(db, "pairs", pairId, "shared", id) : doc(collection(db, "pairs", pairId, "shared")));
const settleRef = (pairId: string, id?: string) => (id ? doc(db, "pairs", pairId, "settlements", id) : doc(collection(db, "pairs", pairId, "settlements")));

export interface PairShared {
  shared: WithId<SharedDoc>[]; settlements: WithId<SettlementDoc>[]; incomes: Record<string, IncomeDoc>; ready: boolean;
}
const EMPTY: PairShared = { shared: [], settlements: [], incomes: {}, ready: true };

/** Gastos, pagos e ingresos de cada pareja en la que estoy (activa o terminada), en tiempo real. */
export function usePairsShared(pairs: Pair[]): Record<string, PairShared> {
  const ids = pairs.map((p) => p.id).sort().join(",");
  const [state, setState] = useState<Record<string, Partial<Record<"shared" | "settlements" | "incomes", unknown>>>>({});
  useEffect(() => {
    if (!ids) { setState({}); return undefined; }
    setState({});
    const unsubs: (() => void)[] = [];
    for (const id of ids.split(",")) {
      for (const col of ["shared", "settlements", "incomes"] as const) {
        unsubs.push(onSnapshot(collection(db, "pairs", id, col),
          (snap) => setState((prev) => ({ ...prev, [id]: { ...prev[id], [col]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) } })),
          () => setState((prev) => ({ ...prev, [id]: { ...prev[id], [col]: [] } }))));
      }
    }
    return () => unsubs.forEach((u) => u());
  }, [ids]);
  const out: Record<string, PairShared> = {};
  for (const id of ids ? ids.split(",") : []) {
    const s = state[id] ?? {};
    const incomes = Object.fromEntries(((s.incomes as WithId<IncomeDoc>[] | undefined) ?? []).map((d) => [d.id, d]));
    out[id] = {
      shared: (s.shared as WithId<SharedDoc>[]) ?? [], settlements: (s.settlements as WithId<SettlementDoc>[]) ?? [], incomes,
      ready: s.shared !== undefined && s.settlements !== undefined && s.incomes !== undefined,
    };
  }
  return out;
}
export const emptyPairShared = EMPTY;

// ------------------------------------------------------------------------- gastos

export interface NewShared {
  date: string; description: string; amount: number; paidBy: string; split: SharedDoc["split"];
  categoryName: string | null; myCategoryId: string | null;
}

/**
 * Apunta un gasto compartido. Si lo pagué yo, en la misma escritura va mi movimiento (el dinero
 * que salió de mi cuenta o tarjeta) y el enlace entre los dos.
 */
export function addShared(uid: string, pairId: string, s: NewShared, payment?: NewExpense): { id: string; undo: Undo } {
  const ref = sharedRef(pairId);
  const mvRef = payment ? userItem(uid, "movements") : null;
  const linkRef = userItem(uid, "sharedLinks", ref.id);
  const b = writeBatch(db);
  b.set(ref, {
    date: s.date, description: s.description, amount: s.amount, paidBy: s.paidBy, createdBy: uid,
    split: s.split, categoryName: s.categoryName, createdAt: now(),
  });
  if (mvRef && payment) b.set(mvRef, { ...payment, createdAt: now(), source: "app", sharedId: ref.id });
  b.set(linkRef, { pairId, categoryId: s.myCategoryId, movementId: mvRef?.id ?? null } satisfies SharedLink);
  fireWrite(b.commit());
  return {
    id: ref.id,
    undo: () => { const u = writeBatch(db); u.delete(ref); u.delete(linkRef); if (mvRef) u.delete(mvRef); fireWrite(u.commit()); },
  };
}

/** Cambia un gasto que creé yo. Si lo pagué yo y está enlazado, mi movimiento cambia con él. */
export function updateShared(uid: string, pairId: string, id: string, before: SharedDoc, patch: Partial<SharedDoc>,
                             myMovement?: { id: string; data: Record<string, unknown> }): Undo {
  const ref = sharedRef(pairId, id);
  const next = { ...before, ...patch, updatedAt: now(), updatedBy: uid };
  const b = writeBatch(db);
  b.set(ref, next);
  const mvPatch = myMovement ? { ...myMovement.data, amount: next.amount, date: next.date, description: next.description, updatedAt: now() } : null;
  if (myMovement && mvPatch) b.set(userItem(uid, "movements", myMovement.id), mvPatch);
  fireWrite(b.commit());
  return () => {
    const u = writeBatch(db);
    u.set(ref, before);
    if (myMovement) u.set(userItem(uid, "movements", myMovement.id), myMovement.data);
    fireWrite(u.commit());
  };
}

/** Borra un gasto que creé yo, con mi enlace y, si lo pagué yo, mi movimiento. */
export function deleteShared(uid: string, pairId: string, id: string, before: SharedDoc, link: SharedLink | null,
                             myMovement?: { id: string; data: Record<string, unknown> }): Undo {
  const b = writeBatch(db);
  b.delete(sharedRef(pairId, id));
  if (link) b.delete(userItem(uid, "sharedLinks", id));
  if (myMovement) b.delete(userItem(uid, "movements", myMovement.id));
  fireWrite(b.commit());
  return () => {
    const u = writeBatch(db);
    u.set(sharedRef(pairId, id), before);
    if (link) u.set(userItem(uid, "sharedLinks", id), link);
    if (myMovement) u.set(userItem(uid, "movements", myMovement.id), myMovement.data);
    fireWrite(u.commit());
  };
}

/** Lo pagué yo (lo apuntó mi pareja o borré el movimiento): registro con qué y lo enlazo. */
export function linkPayment(uid: string, pairId: string, sharedId: string, payment: NewExpense, categoryId: string | null, before: SharedLink | null): Undo {
  const mvRef = userItem(uid, "movements");
  const linkRef = userItem(uid, "sharedLinks", sharedId);
  const b = writeBatch(db);
  b.set(mvRef, { ...payment, createdAt: now(), source: "app", sharedId });
  b.set(linkRef, { pairId, categoryId, movementId: mvRef.id } satisfies SharedLink);
  fireWrite(b.commit());
  return () => {
    const u = writeBatch(db);
    u.delete(mvRef);
    if (before) u.set(linkRef, before); else u.delete(linkRef);
    fireWrite(u.commit());
  };
}

/** Mi categoría para mi parte de un gasto (la elige cada uno). */
export function setMyCategory(uid: string, pairId: string, sharedId: string, categoryId: string | null, before: SharedLink | null): Undo {
  const ref = userItem(uid, "sharedLinks", sharedId);
  fireWrite(setDoc(ref, { pairId, categoryId, movementId: before?.movementId ?? null } satisfies SharedLink));
  return () => fireWrite(before ? setDoc(ref, before) : deleteDoc(ref));
}

// ------------------------------------------------------------------------- saldar

const settleMovementId = (settlementId: string) => `ss_${settlementId}`;

/** Movimiento de un pago entre la pareja en mi cuenta principal (id fijo: no se duplica). */
function settlementMovement(me: string, s: WithId<SettlementDoc>, main: string, partnerName: string) {
  const paid = s.from === me;
  return {
    type: "transfer", date: s.date, amount: s.amount, transferKind: "sharedSettlement", sharedSettlementId: s.id,
    description: paid ? `Pago a ${partnerName} (gastos compartidos)` : `Pago de ${partnerName} (gastos compartidos)`,
    accountId: paid ? main : null, toAccountId: paid ? null : main, createdAt: now(), source: "app",
  };
}

/** Envío un pago a mi pareja. No toca mis cuentas hasta que lo confirme (E6). */
export function sendSettlement(pairId: string, me: string, partner: string, amount: number, date: string): Undo {
  const ref = settleRef(pairId);
  fireWrite(setDoc(ref, { date, amount, from: me, to: partner, status: "pending", createdAt: now() }));
  return () => fireWrite(setDoc(ref, { status: "cancelled", decidedAt: now() }, { merge: true }));
}

export function cancelSettlement(pairId: string, id: string) {
  fireWrite(setDoc(settleRef(pairId, id), { status: "cancelled", decidedAt: now() }, { merge: true }));
}

/** Confirmo que recibí el pago: queda en mi cuenta principal. La app de quien pagó lo apunta en la suya. */
export function confirmSettlement(uid: string, pairId: string, s: WithId<SettlementDoc>, main: string, partnerName: string) {
  const b = writeBatch(db);
  b.update(settleRef(pairId, s.id), { status: "confirmed", decidedAt: now() });
  b.set(userItem(uid, "movements", settleMovementId(s.id)), settlementMovement(uid, s, main, partnerName));
  fireWrite(b.commit());
}

export function rejectSettlement(pairId: string, id: string) {
  fireWrite(setDoc(settleRef(pairId, id), { status: "rejected", decidedAt: now() }, { merge: true }));
}

/**
 * Pagos confirmados que aún no están en mis movimientos (los que hice yo y confirmó mi pareja,
 * o uno que confirmé desde otro dispositivo sin red). Devuelve las escrituras a hacer.
 */
export function missingSettlementMovements(me: string, settlements: WithId<SettlementDoc>[], movements: Record<string, unknown>,
                                           main: string | null, partnerName: string) {
  if (!main) return [];
  return settlements
    .filter((s) => s.status === "confirmed" && (s.from === me || s.to === me) && !movements[settleMovementId(s.id)])
    .map((s) => ({ id: settleMovementId(s.id), data: settlementMovement(me, s, main, partnerName) }));
}

export function writeSettlementMovements(uid: string, items: { id: string; data: Record<string, unknown> }[]) {
  if (!items.length) return;
  const b = writeBatch(db);
  for (const it of items) b.set(userItem(uid, "movements", it.id), it.data);
  fireWrite(b.commit());
}

// ------------------------------------------------------------------------- ingresos

/** Publica mi total cobrado de un mes (solo el total) para el reparto por ingresos. */
export function publishIncome(uid: string, pairId: string, month: string, totalEuros: number) {
  fireWrite(setDoc(doc(db, "pairs", pairId, "incomes", incomeDocId(uid, month)), { uid, month, total: totalEuros, updatedAt: now() }));
}
