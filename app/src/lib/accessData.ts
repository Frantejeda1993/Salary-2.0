/**
 * Lecturas y escrituras de acceso en Firestore: solicitudes (accessRequests/{email}) y
 * lista de invitados (allowlist/{email}, solo administrador).
 */
import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeEmail, type AccessRequest } from "./access";

const now = () => new Date().toISOString();
const reqRef = (email: string) => doc(db, "accessRequests", normalizeEmail(email));
const allowRef = (email: string) => doc(db, "allowlist", normalizeEmail(email));

export interface Me { uid: string; email: string; name: string }

/**
 * Pide acceso para `email` (el propio o el de un amigo). Si ya existía una solicitud, las
 * reglas no dejan reescribirla: se informa en vez de fallar en silencio.
 */
export async function requestAccess(me: Me, email: string): Promise<"created" | "exists"> {
  const e = normalizeEmail(email);
  const data: AccessRequest = {
    email: e, status: "pending", requestedByUid: me.uid, requestedByEmail: normalizeEmail(me.email),
    requestedByName: me.name || me.email, createdAt: now(),
  };
  try {
    await setDoc(reqRef(e), data);
    return "created";
  } catch {
    return "exists";
  }
}

/** El administrador da acceso directamente (sin solicitud previa) o al aprobar una. */
export async function grantAccess(admin: Me, email: string, fromRequest?: AccessRequest): Promise<void> {
  const e = normalizeEmail(email);
  const b = writeBatch(db);
  b.set(allowRef(e), { addedAt: now(), addedBy: admin.email, ...(fromRequest ? { invitedBy: fromRequest.requestedByEmail } : {}) });
  if (fromRequest) b.update(reqRef(e), { status: "approved" });
  await b.commit();
}

export const rejectRequest = (email: string) => setDoc(reqRef(email), { status: "rejected" }, { merge: true });
export const deleteRequest = (email: string) => deleteDoc(reqRef(email));
export const revokeAccess = (email: string) => deleteDoc(allowRef(email));

/** Mi propia solicitud (para la pantalla «Sin acceso»). */
export async function myRequest(email: string): Promise<AccessRequest | null> {
  try {
    const s = await getDoc(reqRef(email));
    return s.exists() ? (s.data() as AccessRequest) : null;
  } catch {
    return null;
  }
}

function useQuerySnapshot<T>(enabled: boolean, build: () => ReturnType<typeof query> | ReturnType<typeof collection>): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!enabled) { setRows([]); return undefined; }
    return onSnapshot(build() as never, (snap: { docs: { id: string; data: () => unknown }[] }) =>
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T)), () => setRows([]));
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/** Las invitaciones que he hecho yo. */
export const useMyInvites = (uid: string | undefined) =>
  useQuerySnapshot<AccessRequest & { id: string }>(!!uid, () => query(collection(db, "accessRequests"), where("requestedByUid", "==", uid)));

/** Administrador: todas las solicitudes y la lista de invitados. */
export const useAllRequests = (isAdmin: boolean) =>
  useQuerySnapshot<AccessRequest & { id: string }>(isAdmin, () => collection(db, "accessRequests"));
export const useAllowlist = (isAdmin: boolean) =>
  useQuerySnapshot<{ id: string; addedAt?: string; invitedBy?: string }>(isAdmin, () => collection(db, "allowlist"));
