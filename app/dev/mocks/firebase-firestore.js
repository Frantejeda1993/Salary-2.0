// Firestore simulado en memoria + localStorage (solo npm run dev:mock). Misma API que usa la app.
const KEY = "salary-mock-firestore";
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* */ }
const subs = new Set();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* */ } };
const notify = () => { persist(); subs.forEach((s) => s()); };
let n = 0;
const autoId = () => `m${Date.now().toString(36)}${(n++).toString(36)}`;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const serverTimestamp = () => new Date().toISOString();

export function collection(_db, ...parts) { return { type: "col", path: parts.join("/") }; }
export function doc(dbOrCol, ...parts) {
  if (dbOrCol?.type === "col") {
    const path = `${dbOrCol.path}/${parts[0] || autoId()}`;
    return { type: "doc", path, id: path.split("/").pop() };
  }
  const path = parts.join("/");
  return { type: "doc", path, id: path.split("/").pop() };
}
const parentOf = (path) => path.split("/").slice(0, -1).join("/");

export async function setDoc(ref, data, opts) {
  store[ref.path] = opts?.merge ? { ...(store[ref.path] || {}), ...clone(data) } : clone(data);
  notify();
}
export async function updateDoc(ref, data) {
  if (!store[ref.path]) throw new Error("not-found");
  store[ref.path] = { ...store[ref.path], ...clone(data) };
  notify();
}
export async function deleteDoc(ref) { delete store[ref.path]; notify(); }
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, opts) => ops.push(() => {
      store[ref.path] = opts?.merge ? { ...(store[ref.path] || {}), ...clone(data) } : clone(data);
    }),
    update: (ref, data) => ops.push(() => { store[ref.path] = { ...store[ref.path], ...clone(data) }; }),
    delete: (ref) => ops.push(() => { delete store[ref.path]; }),
    commit: async () => { ops.forEach((o) => o()); notify(); },
  };
}

export function onSnapshot(ref, cb) {
  const run = () => {
    if (ref.type === "doc") {
      const data = clone(store[ref.path]);
      cb({ exists: () => !!data, data: () => data, id: ref.id, metadata: { fromCache: false } });
    } else {
      const docs = Object.keys(store).sort()
        .filter((p) => parentOf(p) === ref.path)
        .map((p) => ({ id: p.split("/").pop(), data: () => clone(store[p]) }));
      cb({ docs, metadata: { fromCache: false } });
    }
  };
  subs.add(run);
  setTimeout(run, 0);
  return () => subs.delete(run);
}

/** Solo en modo prueba: borra todo. */
export function __resetMockStore() { store = {}; notify(); }
