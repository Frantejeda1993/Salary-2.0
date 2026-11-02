/** Firestore de las parejas (pairs/{id}). Las reglas validan cada transición. */
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, type QuerySnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeEmail } from "./access";
import type { Me } from "./accessData";
import { pairState, type Pair, type PairState } from "./pairs";

const now = () => new Date().toISOString();
const pairsCol = () => collection(db, "pairs");

export async function invitePartner(me: Me, email: string): Promise<string> {
  const ref = doc(pairsCol());
  await setDoc(ref, {
    members: [me.uid], status: "pending", invitedBy: me.uid, invitedEmail: normalizeEmail(email),
    names: { [me.uid]: me.name }, emails: { [me.uid]: normalizeEmail(me.email) }, createdAt: now(),
  });
  return ref.id;
}

export async function acceptPair(me: Me, p: Pair): Promise<void> {
  await setDoc(doc(db, "pairs", p.id), {
    members: [p.members[0], me.uid], status: "active", invitedBy: p.invitedBy, invitedEmail: p.invitedEmail,
    names: { ...p.names, [me.uid]: me.name }, emails: { ...p.emails, [me.uid]: normalizeEmail(me.email) },
    createdAt: p.createdAt ?? null, acceptedAt: now(),
  });
}

export const declinePair = (p: Pair) => updateDoc(doc(db, "pairs", p.id), { status: "declined", endedAt: now() });
export const cancelPair = (p: Pair) => updateDoc(doc(db, "pairs", p.id), { status: "cancelled", endedAt: now() });
export const endPair = (p: Pair, uid: string) => updateDoc(doc(db, "pairs", p.id), { status: "ended", endedAt: now(), endedBy: uid });

/** Mis parejas (en las que soy miembro) e invitaciones a mi email, en tiempo real. */
export function usePairs(uid: string | undefined, email: string | undefined): PairState & { ready: boolean; mine: Pair[] } {
  const [mine, setMine] = useState<Pair[] | null>(null);
  const [toMe, setToMe] = useState<Pair[] | null>(null);
  useEffect(() => {
    if (!uid) return undefined;
    const map = (snap: QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Pair);
    const u1 = onSnapshot(query(pairsCol(), where("members", "array-contains", uid)), (s) => setMine(map(s)), () => setMine([]));
    const u2 = email
      ? onSnapshot(query(pairsCol(), where("invitedEmail", "==", normalizeEmail(email)), where("status", "==", "pending")),
        (s) => setToMe(map(s)), () => setToMe([]))
      : (setToMe([]), () => undefined);
    return () => { u1(); u2(); };
  }, [uid, email]);
  return { ...pairState(mine ?? [], toMe ?? [], uid ?? ""), ready: mine !== null && toMe !== null, mine: mine ?? [] };
}
