import { collection, doc } from "firebase/firestore";
import { db } from "../firebase";

/** Colecciones del usuario (modelo nuevo, ver especificación sección 5). */
export const USER_COLLECTIONS = [
  "accounts", "cards", "categories", "salaries", "fixedExpenses", "budgets", "movements", "cardSettlements",
] as const;
export type UserCollection = (typeof USER_COLLECTIONS)[number];

export const userDoc = (uid: string) => doc(db, "users", uid);
export const userCol = (uid: string, c: UserCollection) => collection(db, "users", uid, c);
export const userItem = (uid: string, c: UserCollection, id?: string) =>
  id ? doc(db, "users", uid, c, id) : doc(userCol(uid, c));
