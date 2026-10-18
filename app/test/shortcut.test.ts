import { describe, expect, it } from "vitest";
import { shortcutPrefix } from "../src/components/ShortcutGuide";

describe("texto del atajo", () => {
  it("codifica el nombre y deja el importe para el final", () => {
    const p = shortcutPrefix("https://x.github.io/Salary-2.0/", "tarjeta", "Tarjeta Cuenta *1425");
    expect(p).toBe("https://x.github.io/Salary-2.0/#/nuevo?tarjeta=Tarjeta%20Cuenta%20%2A1425&importe=");
    const q = new URLSearchParams(`${p.split("?")[1]}12%2C50%20%E2%82%AC&comercio=Caf%C3%A9%20%26%20Co`);
    expect([q.get("tarjeta"), q.get("importe"), q.get("comercio")]).toEqual(["Tarjeta Cuenta *1425", "12,50 €", "Café & Co"]);
  });
  it("cuenta de débito", () => {
    expect(shortcutPrefix("https://x/", "cuenta", "Cuenta *1425")).toBe("https://x/#/nuevo?cuenta=Cuenta%20%2A1425&importe=");
  });
});
