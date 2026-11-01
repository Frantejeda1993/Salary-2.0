/**
 * Reglas de Firestore contra el emulador (solo en CI: el emulador se descarga de Google).
 * Uso: npm test  (lanza el emulador, ejecuta y lo apaga).
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
const ADMIN = { uid: "admin", email: "frantejeda1993@gmail.com" };
const ANA = { uid: "ana", email: "ana@example.com" };      // invitada
const LUIS = { uid: "luis", email: "luis@example.com" };   // sin invitación
const as = (u: { uid: string; email: string }, verified = true) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore();
const req = (email: string, by: { uid: string; email: string }, extra: Record<string, unknown> = {}) =>
  ({ email, status: "pending", requestedByUid: by.uid, requestedByEmail: by.email, requestedByName: "X", createdAt: "2026-11-01T00:00:00Z", ...extra });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-salary", firestore: { rules: readFileSync("../firestore.rules", "utf8") } });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "allowlist/ana@example.com"), { addedBy: "admin" });
    await setDoc(doc(ctx.firestore(), "users/ana"), { displayName: "Ana" });
    await setDoc(doc(ctx.firestore(), "users/admin"), { displayName: "Admin" });
  });
});

describe("datos de cada usuario", () => {
  it("el administrador y los invitados leen y escriben lo suyo", async () => {
    await assertSucceeds(getDoc(doc(as(ADMIN), "users/admin")));
    await assertSucceeds(setDoc(doc(as(ANA), "users/ana/movements/m1"), { amount: 1 }));
  });
  it("nadie lee lo de otro, ni el administrador", async () => {
    await assertFails(getDoc(doc(as(ANA), "users/admin")));
    await assertFails(getDoc(doc(as(ADMIN), "users/ana/movements/m1")));
  });
  it("sin invitación o sin email verificado, nada", async () => {
    await assertFails(setDoc(doc(as(LUIS), "users/luis"), { x: 1 }));
    await assertFails(getDoc(doc(as(ANA, false), "users/ana")));
  });
  it("meta solo la escribe la migración", async () => {
    await assertFails(setDoc(doc(as(ANA), "users/ana/meta/x"), { a: 1 }));
  });
});

describe("lista de invitados", () => {
  it("solo el administrador la lee y la cambia", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "allowlist/luis@example.com"), { addedBy: "admin" }));
    await assertFails(getDoc(doc(as(ANA), "allowlist/ana@example.com")));
    await assertFails(setDoc(doc(as(ANA), "allowlist/luis@example.com"), {}));
    await assertFails(setDoc(doc(as(LUIS), "allowlist/luis@example.com"), {}));
  });
  it("al aprobar, el invitado entra", async () => {
    await assertFails(setDoc(doc(as(LUIS), "users/luis"), { x: 1 }));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "allowlist/luis@example.com"), {}); });
    await assertSucceeds(setDoc(doc(as(LUIS), "users/luis"), { x: 1 }));
  });
});

describe("solicitudes de acceso", () => {
  it("cualquiera con Google puede pedir acceso para sí mismo", async () => {
    await assertSucceeds(setDoc(doc(as(LUIS), "accessRequests/luis@example.com"), req("luis@example.com", LUIS)));
  });
  it("sin invitación no puede pedirlo para otro", async () => {
    await assertFails(setDoc(doc(as(LUIS), "accessRequests/eva@example.com"), req("eva@example.com", LUIS)));
  });
  it("un invitado puede invitar a otra persona", async () => {
    await assertSucceeds(setDoc(doc(as(ANA), "accessRequests/eva@example.com"), req("eva@example.com", ANA)));
  });
  it("no se puede crear ya aprobada, a nombre de otro ni con campos raros", async () => {
    await assertFails(setDoc(doc(as(ANA), "accessRequests/eva@example.com"), req("eva@example.com", ANA, { status: "approved" })));
    await assertFails(setDoc(doc(as(ANA), "accessRequests/eva@example.com"), req("eva@example.com", LUIS)));
    await assertFails(setDoc(doc(as(ANA), "accessRequests/eva@example.com"), req("eva@example.com", ANA, { admin: true })));
    await assertFails(setDoc(doc(as(ANA), "accessRequests/Eva@Example.com"), req("Eva@Example.com", ANA)));
  });
  it("la ven quien la pidió, la persona invitada y el administrador; nadie más", async () => {
    await assertSucceeds(setDoc(doc(as(ANA), "accessRequests/luis@example.com"), req("luis@example.com", ANA)));
    await assertSucceeds(getDoc(doc(as(ANA), "accessRequests/luis@example.com")));
    await assertSucceeds(getDoc(doc(as(LUIS), "accessRequests/luis@example.com")));
    await assertSucceeds(getDoc(doc(as(ADMIN), "accessRequests/luis@example.com")));
    await assertFails(getDoc(doc(as({ uid: "eva", email: "eva@example.com" }), "accessRequests/luis@example.com")));
  });
  it("solo el administrador la aprueba, la rechaza o la borra; no se puede reescribir", async () => {
    await assertSucceeds(setDoc(doc(as(LUIS), "accessRequests/luis@example.com"), req("luis@example.com", LUIS)));
    await assertFails(updateDoc(doc(as(LUIS), "accessRequests/luis@example.com"), { status: "approved" }));
    await assertFails(setDoc(doc(as(LUIS), "accessRequests/luis@example.com"), req("luis@example.com", LUIS)));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "accessRequests/luis@example.com"), { status: "approved" }));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "accessRequests/luis@example.com")));
  });
});

describe("cuentas compartidas (pairs)", () => {
  const EVA = { uid: "eva", email: "eva@example.com" };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "allowlist/eva@example.com"), {});
    });
  });
  const invite = (by = ANA, to = "eva@example.com") => ({
    members: [by.uid], status: "pending", invitedBy: by.uid, invitedEmail: to,
    names: { [by.uid]: "Ana" }, emails: { [by.uid]: by.email }, createdAt: "2026-11-01",
  });
  const accepted = (base: ReturnType<typeof invite>, me = EVA) => ({
    ...base, status: "active", members: [base.members[0], me.uid],
    names: { ...base.names, [me.uid]: "Eva" }, emails: { ...base.emails, [me.uid]: me.email }, acceptedAt: "2026-11-02",
  });

  it("un invitado crea la invitación a nombre propio; nadie más", async () => {
    await assertSucceeds(setDoc(doc(as(ANA), "pairs/p1"), invite()));
    await assertFails(setDoc(doc(as(LUIS), "pairs/p2"), invite(LUIS)));                       // sin acceso
    await assertFails(setDoc(doc(as(ANA), "pairs/p3"), { ...invite(), members: [ANA.uid, EVA.uid] }));
    await assertFails(setDoc(doc(as(ANA), "pairs/p4"), { ...invite(), status: "active" }));
    await assertFails(setDoc(doc(as(ANA), "pairs/p5"), invite(ANA, "ana@example.com")));      // a sí misma
    await assertFails(setDoc(doc(as(ANA), "pairs/p6"), { ...invite(), names: { ana: "Ana", eva: "X" } }));
  });
  it("la invitación la ven quien invita y la persona invitada; nadie más", async () => {
    await setDoc(doc(as(ANA), "pairs/p1"), invite());
    await assertSucceeds(getDoc(doc(as(EVA), "pairs/p1")));
    await assertSucceeds(getDoc(doc(as(ANA), "pairs/p1")));
    await assertFails(getDoc(doc(as(ADMIN), "pairs/p1")));
  });
  it("la invitada acepta; no puede tocar los datos de quien invita ni entrar otro", async () => {
    await setDoc(doc(as(ANA), "pairs/p1"), invite());
    await assertFails(setDoc(doc(as(ADMIN), "pairs/p1"), accepted(invite(), ADMIN)));
    await assertFails(setDoc(doc(as(EVA), "pairs/p1"), { ...accepted(invite()), names: { ana: "Otra", eva: "Eva" } }));
    await assertSucceeds(setDoc(doc(as(EVA), "pairs/p1"), accepted(invite())));
    await assertSucceeds(getDoc(doc(as(EVA), "pairs/p1")));
  });
  it("rechazar, cancelar y dejar de compartir", async () => {
    await setDoc(doc(as(ANA), "pairs/p1"), invite());
    await assertFails(updateDoc(doc(as(ANA), "pairs/p1"), { status: "declined" }));
    await assertSucceeds(updateDoc(doc(as(EVA), "pairs/p1"), { status: "declined", endedAt: "x" }));
    await setDoc(doc(as(ANA), "pairs/p2"), invite());
    await assertFails(updateDoc(doc(as(EVA), "pairs/p2"), { status: "cancelled", endedAt: "x" }));
    await assertSucceeds(updateDoc(doc(as(ANA), "pairs/p2"), { status: "cancelled", endedAt: "x" }));
    await setDoc(doc(as(ANA), "pairs/p3"), invite());
    await setDoc(doc(as(EVA), "pairs/p3"), accepted(invite()));
    await assertFails(updateDoc(doc(as(ADMIN), "pairs/p3"), { status: "ended", endedAt: "x", endedBy: "admin" }));
    await assertSucceeds(updateDoc(doc(as(EVA), "pairs/p3"), { status: "ended", endedAt: "x", endedBy: "eva" }));
    await assertFails(updateDoc(doc(as(EVA), "pairs/p3"), { status: "active" }));
    await assertFails(deleteDoc(doc(as(ANA), "pairs/p3")));
  });
});
