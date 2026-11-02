import { describe, expect, it } from "vitest";
import { inviteMessage, isAdminEmail, normalizeEmail, requestOrigin, validEmail } from "../src/lib/access";

describe("acceso por invitación", () => {
  it("emails", () => {
    expect(normalizeEmail("  Ana.Perez@Gmail.com ")).toBe("ana.perez@gmail.com");
    expect(validEmail("ana@empresa.es")).toBe(true);
    expect(validEmail("ana@gmail")).toBe(false);
    expect(validEmail("ana gmail.com")).toBe(false);
  });
  it("administrador", () => {
    expect(isAdminEmail("FranTejeda1993@gmail.com")).toBe(true);
    expect(isAdminEmail("demo@example.com")).toBe(false);
    expect(isAdminEmail("demo@example.com", true)).toBe(true);
    expect(isAdminEmail(null)).toBe(false);
  });
  it("mensaje de invitación", () => {
    const m = inviteMessage("https://x/app/", "Ana", false);
    expect(m).toContain("https://x/app/");
    expect(m).toContain("He pedido tu acceso");
    expect(inviteMessage("u", "Ana", true)).toContain("Ya tienes acceso");
    expect(inviteMessage("u", "Ana", true)).toContain("releases/latest/download/salary.apk");
  });
  it("origen de la solicitud", () => {
    const base = { email: "luis@x.com", status: "pending" as const, requestedByUid: "a", createdAt: "" };
    expect(requestOrigin({ ...base, requestedByEmail: "ana@x.com", requestedByName: "Ana" })).toBe("Lo invita Ana");
    expect(requestOrigin({ ...base, requestedByEmail: "luis@x.com", requestedByName: "Luis" })).toBe("Lo pidió desde la app");
  });
});
