import { describe, expect, it } from "vitest";
import { cannotInvite, pairState, partnerOf, type Pair } from "../src/lib/pairs";

const P = (o: Partial<Pair>): Pair => ({
  id: "p", members: ["a"], status: "pending", invitedBy: "a", invitedEmail: "eva@x.com",
  names: { a: "Ana" }, emails: { a: "ana@x.com" }, createdAt: "2026-11-01", ...o,
});

describe("parejas", () => {
  it("estado: activa, enviada y recibidas", () => {
    const s = pairState([P({ id: "out" }), P({ id: "old", status: "ended", members: ["a", "e"] })], [P({ id: "in", invitedBy: "z", members: ["z"] })], "a");
    expect(s.active).toBeNull();
    expect(s.outgoing?.id).toBe("out");
    expect(s.incoming.map((p) => p.id)).toEqual(["in"]);
    expect(pairState([P({ status: "active", members: ["a", "e"] })], [], "a").active).not.toBeNull();
  });
  it("la otra persona", () => {
    const act = P({ status: "active", members: ["a", "e"], names: { a: "Ana", e: "Eva" }, emails: { a: "ana@x.com", e: "eva@x.com" } });
    expect(partnerOf(act, "a")).toEqual({ uid: "e", name: "Eva", email: "eva@x.com" });
    expect(partnerOf(act, "e").name).toBe("Ana");
    expect(partnerOf(P({}), "a")).toEqual({ uid: null, name: "eva@x.com", email: "eva@x.com" });
    expect(partnerOf(P({}), "e").name).toBe("Ana");
  });
  it("cuándo no se puede invitar", () => {
    const empty = { active: null, outgoing: null, incoming: [] };
    expect(cannotInvite(empty, "eva@x.com", "ana@x.com")).toBeNull();
    expect(cannotInvite(empty, "ANA@x.com", "ana@x.com")).toMatch(/ti mismo/);
    expect(cannotInvite({ ...empty, outgoing: P({}) }, "b@x.com", "a@x.com")).toMatch(/pendiente/);
    expect(cannotInvite({ ...empty, active: P({ status: "active" }) }, "b@x.com", "a@x.com")).toMatch(/Ya compartes/);
  });
});
