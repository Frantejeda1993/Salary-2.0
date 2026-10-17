/**
 * Escrituras de la app. Ninguna se espera (no hay `await`): con la caché persistente de
 * Firestore el cambio se aplica al instante en local y se sube cuando hay red, así que la
 * app responde igual sin cobertura. Si el servidor la rechaza, avisa el manejador de errores.
 * Cada acción devuelve cómo deshacerla.
 */
import { deleteDoc, deleteField, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { userItem } from "./paths";

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

export function deleteMovement(uid: string, id: string, data: Record<string, unknown>): Undo {
  const ref = userItem(uid, "movements", id);
  run(deleteDoc(ref));
  return () => run(setDoc(ref, data));
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
  const left = Math.max(Math.round((outstanding - amount) * 100) / 100, 0);
  const loanRef = userItem(uid, "movements", loanId);
  const repRef = userItem(uid, "movements");
  const b = writeBatch(db);
  b.set(repRef, {
    type: "transfer", date, amount, description: "Devolución de préstamo",
    accountId: loan.toAccountId, toAccountId: loan.accountId, transferKind: "loanRepayment", loanId,
    createdAt: now(), source: "app",
  });
  b.update(loanRef, { loan: { status: left === 0 ? "paid" : "pending", outstanding: left } });
  run(b.commit());
  return () => {
    const u = writeBatch(db);
    u.delete(repRef);
    u.update(loanRef, { loan: current ?? deleteField() });
    run(u.commit());
  };
}
