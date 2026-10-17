// Auth simulado (npm run dev:mock). Entra siempre como un usuario de prueba.
const listeners = new Set();
let current = null;
const KEY = "salary-mock-auth-user";
try { current = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin almacenamiento */ }
const emit = () => listeners.forEach((cb) => cb(current));

export const getAuth = () => ({});
export function onAuthStateChanged(_auth, cb) {
  listeners.add(cb);
  setTimeout(() => cb(current), 0);
  return () => listeners.delete(cb);
}
export class GoogleAuthProvider { setCustomParameters() {} }
export async function signInWithPopup() {
  current = { uid: "mock-uid", email: "demo@example.com", displayName: "Usuario de prueba" };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* */ }
  emit();
}
export const signInWithRedirect = signInWithPopup;
export const getRedirectResult = async () => null;
export async function signOut() {
  current = null;
  try { localStorage.removeItem(KEY); } catch { /* */ }
  emit();
}
