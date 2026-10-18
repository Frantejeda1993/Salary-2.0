/**
 * Escrituras de la app. Ninguna se espera (no hay `await`): con la caché persistente de
 * Firestore el cambio se aplica al instante en local y se sube cuando hay red, así que la
 * app responde igual sin cobertura. Si el servidor la rechaza, avisa el manejador de errores.
 * Cada acción devuelve cómo deshacerla.
 */
import { deleteDoc, deleteField, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { userDoc, userItem, type UserCollection } from "./paths";
import { loanAfterAmountChange, loanAfterRepayment } from "./plan";

export type Undo = () => void;

let onError: (msg: string) => void = (m) => console.error(m);
export function setWriteErrorHandler(fn: (msg: string) => void) { onError = fn; }
const report = (e: unknown) => onError(
  (e as { code?: string })?.code === "permission-denied"
    ? "El servidor rechazó el cambio (permiso denegado). No se ha guardado."
    : `No se pudo guardar: ${(e as Error)?.message ?? e}`,
);
const run = (p: Promise<unknown>) => { p.catch(report); };

/** Céntimos del motor -> euros de Firestore. */
export const toEuros = (cents: number) => Math.round(cents) / 100;
const now = () => new Date().toISOString();

export type Source = "app" | "shortcut";

export interface NewExpense {
  type: "expense"; date: string; amount: number; description: string; categoryId: string | null; accountId: string;
  card?: { cardId: string; chargeMonth: string; reserveIn: "purchase" | "charge" };
}
export interface NewIncome { type: "income"; date: string; amount: number; description: string; categoryId: string | null; accountId: string }
export interface NewTransfer {
  type: "transfer"; date: string; amount: number; description: string; accountId: string; toAccountId: string;
  transferKind: "normal" | "loan" | "loanRepayment" | "ownExpenseRefund";
  loan?: { status: "pending" | "paid"; outstanding: number }; loanId?: string;
}
export type NewMovement = NewExpense | NewIncome | NewTransfer;

export function addMovement(uid: string, m: NewMovement, source: Source = "app"): { id: string; undo: Undo } {
  const ref = userItem(uid, "movements");
  run(setDoc(ref, { ...m, createdAt: now(), source }));
  return { id: ref.id, undo: () => run(deleteDoc(ref)) };
}

type Raw = Record<string, unknown>;
type LoanState = { status: "pending" | "paid"; outstanding: number };

/**
 * Borra un movimiento. Si es una devolución de préstamo registrada en esta app (con loanId),
 * el préstamo recupera ese importe pendiente, en la misma escritura.
 */
export function deleteMovement(uid: string, id: string, data: Raw, loan?: Raw): Undo {
  const ref = userItem(uid, "movements", id);
  const loanId = data.loanId as string | undefined;
  if (data.transferKind === "loanRepayment" && loanId && loan) {
    const before = loan.loan as LoanState;
    const after = loanAfterRepayment(loan.amount as number, before.outstanding, -(data.amount as number));
    const loanRef = userItem(uid, "movements", loanId);
    const b = writeBatch(db);
    b.delete(ref);
    b.update(loanRef, { loan: after });
    run(b.commit());
    return () => { const u = writeBatch(db); u.set(ref, data); u.update(loanRef, { loan: before }); run(u.commit()); };
  }
  run(deleteDoc(ref));
  return () => run(setDoc(ref, data));
}

/**
 * Sustituye un movimiento por su versión editada (conserva createdAt, source y legacy).
 * Préstamo: si cambia el importe, se conserva lo devuelto. Devolución con loanId: el
 * préstamo se ajusta por la diferencia.
 */
export function updateMovement(uid: string, id: string, before: Raw, after: Raw, loan?: Raw): Undo {
  const ref = userItem(uid, "movements", id);
  const next: Raw = { ...before, ...after, updatedAt: now() };
  if (next.card === undefined) delete next.card;
  if (before.transferKind === "loan" && before.loan && after.amount !== before.amount) {
    const l = before.loan as LoanState;
    next.loan = loanAfterAmountChange(before.amount as number, l.outstanding, after.amount as number);
  }
  const loanId = before.loanId as string | undefined;
  if (before.transferKind === "loanRepayment" && loanId && loan && after.amount !== before.amount) {
    const l = loan.loan as LoanState;
    const loanRef = userItem(uid, "movements", loanId);
    const b = writeBatch(db);
    b.set(ref, next);
    b.update(loanRef, { loan: loanAfterRepayment(loan.amount as number, l.outstanding, (after.amount as number) - (before.amount as number)) });
    run(b.commit());
    return () => { const u = writeBatch(db); u.set(ref, before); u.update(loanRef, { loan: l }); run(u.commit()); };
  }
  run(setDoc(ref, next));
  return () => run(setDoc(ref, before));
}

/** Crear un documento en una colección del usuario. */
export function createItem(uid: string, col: UserCollection, data: Raw): { id: string; undo: Undo } {
  const ref = userItem(uid, col);
  run(setDoc(ref, { ...data, createdAt: now(), source: "app" }));
  return { id: ref.id, undo: () => run(deleteDoc(ref)) };
}

/** Cambiar campos de un documento; deshacer lo deja exactamente como estaba. */
export function patchItem(uid: string, col: UserCollection, id: string, patch: Raw, before: Raw): Undo {
  const ref = userItem(uid, col, id);
  run(updateDoc(ref, { ...patch, updatedAt: now() }));
  return () => run(setDoc(ref, before));
}

export function deleteItem(uid: string, col: UserCollection, id: string, before: Raw): Undo {
  const ref = userItem(uid, col, id);
  run(deleteDoc(ref));
  return () => run(setDoc(ref, before));
}

/** Cambiar ajustes del perfil (users/{uid}.settings), con deshacer. */
export function patchSettings(uid: string, before: Raw, patch: Raw): Undo {
  run(setDoc(userDoc(uid), { settings: { ...before, ...patch } }, { merge: true }));
  return () => run(setDoc(userDoc(uid), { settings: before }, { merge: true }));
}

type Payment = { status: "paid" | "unpaid"; amount: number | null } & Record<string, unknown>;

/** Marca (o desmarca, con null) un gasto fijo en un mes. `amount` null = el importe previsto. */
export function setFixedPayment(uid: string, fixedId: string, month: string, payment: Payment | null, previous: Payment | undefined): Undo {
  const ref = userItem(uid, "fixedExpenses", fixedId);
  const field = `payments.${month}`;
  run(updateDoc(ref, { [field]: payment ?? deleteField() }));
  return () => run(updateDoc(ref, { [field]: previous ?? deleteField() }));
}

export function settleCard(uid: string, s: { cardId: string; accountId: string; chargeMonth: string; date: string; amount: number }): Undo {
  const ref = userItem(uid, "cardSettlements", `${s.cardId}_${s.chargeMonth}`);
  run(setDoc(ref, { ...s, createdAt: now(), source: "app" }));
  return () => run(deleteDoc(ref));
}

export function unsettleCard(uid: string, id: string, data: Record<string, unknown>): Undo {
  const ref = userItem(uid, "cardSettlements", id);
  run(deleteDoc(ref));
  return () => run(setDoc(ref, data));
}

export function refundOwnExpenses(uid: string, r: { from: string; to: string; amount: number; date: string }): Undo {
  return addMovement(uid, {
    type: "transfer", date: r.date, amount: r.amount, description: "Reembolso de gastos propios",
    accountId: r.from, toAccountId: r.to, transferKind: "ownExpenseRefund",
  }).undo;
}

/**
 * Devolución (total o parcial) de un préstamo, como en la app vieja: una transferencia en
 * sentido contrario y el préstamo con su pendiente rebajado (saldado al llegar a 0).
 */
export function repayLoan(uid: string, loanId: string, loan: Record<string, unknown>, amount: number, date: string): Undo {
  const current = loan.loan as { status: string; outstanding: number } | undefined;
  const outstanding = current?.outstanding ?? (loan.amount as number);
  const after = loanAfterRepayment(loan.amount as number, outstanding, amount);
  const loanRef = userItem(uid, "movements", loanId);
  const repRef = userItem(uid, "movements");
  const b = writeBatch(db);
  b.set(repRef, {
    type: "transfer", date, amount, description: "Devolución de préstamo",
    accountId: loan.toAccountId, toAccountId: loan.accountId, transferKind: "loanRepayment", loanId,
    createdAt: now(), source: "app",
  });
  b.update(loanRef, { loan: after });
  run(b.commit());
  return () => {
    const u = writeBatch(db);
    u.delete(repRef);
    u.update(loanRef, { loan: current ?? deleteField() });
    run(u.commit());
  };
}
