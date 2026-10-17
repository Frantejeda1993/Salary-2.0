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

const DELETE = "__mock_delete_field__";
export const deleteField = () => DELETE;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
// set con merge: fusión profunda de mapas, como Firestore.
function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
// update: las claves con puntos son rutas ("payments.2026-10") y reemplazan ese campo entero.
function applyUpdate(base, data) {
  const out = clone(base);
  for (const [path, v] of Object.entries(data)) {
    const parts = path.split(".");
    let o = out;
    for (const p of parts.slice(0, -1)) { if (!isObj(o[p])) o[p] = {}; o = o[p]; }
    const last = parts[parts.length - 1];
    if (v === DELETE) delete o[last]; else o[last] = clone(v);
  }
  return out;
}
const doSet = (ref, data, opts) => { store[ref.path] = opts?.merge ? deepMerge(store[ref.path], data) : deepMerge({}, data); };
const doUpdate = (ref, data) => {
  if (!store[ref.path]) throw Object.assign(new Error("not-found"), { code: "not-found" });
  store[ref.path] = applyUpdate(store[ref.path], data);
};

export async function setDoc(ref, data, opts) { doSet(ref, data, opts); notify(); }
export async function updateDoc(ref, data) { doUpdate(ref, data); notify(); }
export async function deleteDoc(ref) { delete store[ref.path]; notify(); }
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, opts) => ops.push(() => doSet(ref, data, opts)),
    update: (ref, data) => ops.push(() => doUpdate(ref, data)),
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
