import { describe, expect, it } from "vitest";
import {
  cardChargeMonth, findDuplicate, findMerchant, lastPayWith, matchByName, merchantHistory, parseShortcutDate,
  suggestMerchants, todayIn,
} from "../src/lib/quickadd";

describe("cardChargeMonth (D6)", () => {
  it("sin día de corte: el mes siguiente, como la app vieja", () => {
    expect(cardChargeMonth({ cutoffDay: null }, "2026-10-31")).toBe("2026-11");
    expect(cardChargeMonth({}, "2026-12-03")).toBe("2027-01");
  });
  it("con día de corte: hasta el corte, extracto de ese mes; después, del siguiente", () => {
    const visa = { cutoffDay: 25, chargeOffsetMonths: 1 };
    expect(cardChargeMonth(visa, "2026-10-25")).toBe("2026-11");
    expect(cardChargeMonth(visa, "2026-10-26")).toBe("2026-12");
  });
  it("respeta chargeOffsetMonths", () => {
    expect(cardChargeMonth({ cutoffDay: null, chargeOffsetMonths: 0 }, "2026-10-05")).toBe("2026-10");
    expect(cardChargeMonth({ cutoffDay: 10, chargeOffsetMonths: 2 }, "2026-11-20")).toBe("2027-02");
  });
});

const movs = {
  a: { type: "expense", date: "2026-10-01", amount: 30.5, description: "Mercadona", categoryId: "super", accountId: "main" },
  b: { type: "expense", date: "2026-10-03", amount: 12, description: "mercadona ", categoryId: "food", accountId: "main", card: { cardId: "visa" } },
  c: { type: "expense", date: "2026-10-02", amount: 50, description: "Repsol", categoryId: "fuel", accountId: "main" },
  d: { type: "income", date: "2026-10-04", amount: 900, description: "Venta", accountId: "main" },
  e: { type: "expense", date: "2026-09-01", amount: 9.99, description: "Café Martínez", categoryId: null, accountId: "sec" },
};

describe("historial de comercios", () => {
  const h = merchantHistory(movs);
  it("agrupa sin distinguir mayúsculas ni espacios y guarda lo último usado", () => {
    const m = findMerchant(h, "MERCADONA")!;
    expect(m.count).toBe(2);
    expect(m.categoryId).toBe("food");
    expect(m.payWith).toBe("card:visa");
  });
  it("ignora los ingresos y ordena por uso", () => {
    expect(h.map((x) => x.name)).toEqual(["mercadona", "Repsol", "Café Martínez"]);
  });
  it("sugiere primero lo que empieza igual y sin acentos", () => {
    expect(suggestMerchants(h, "caf").map((x) => x.name)).toEqual(["Café Martínez"]);
    expect(suggestMerchants(h, "e").map((x) => x.name)).toEqual(["mercadona", "Repsol", "Café Martínez"]);
    expect(suggestMerchants(h, "mercadona")).toEqual([]); // ya está escrito entero
  });
  it("el último medio de pago es el del gasto más reciente", () => {
    expect(lastPayWith(movs)).toBe("card:visa");
    expect(lastPayWith({})).toBeNull();
  });
});

describe("duplicados", () => {
  it("mismo importe, comercio y día", () => {
    expect(findDuplicate(movs, 30.5, "mercadona", "2026-10-01")).toBe("a");
    expect(findDuplicate(movs, 30.51, "mercadona", "2026-10-01")).toBeNull();
    expect(findDuplicate(movs, 30.5, "mercadona", "2026-10-02")).toBeNull();
  });
  it("compara en céntimos (0,1 + 0,2)", () => {
    expect(findDuplicate({ x: { type: "expense", date: "2026-10-01", amount: 0.3, description: "x" } }, 0.1 + 0.2, "X", "2026-10-01")).toBe("x");
  });
});

describe("atajos", () => {
  const cards = { v: { name: "Visa Oro" }, m: { name: "Mastercard" }, old: { name: "Visa vieja", archived: true } };
  it("busca la tarjeta por nombre exacto o parte única", () => {
    expect(matchByName(cards, "visa oro")).toBe("v");
    expect(matchByName(cards, "Visa")).toBe("v"); // la archivada no cuenta
    expect(matchByName(cards, "card")).toBe("m");
    expect(matchByName(cards, "Amex")).toBeNull();
    expect(matchByName({ a: { name: "Visa 1" }, b: { name: "Visa 2" } }, "visa")).toBeNull(); // ambigua
  });
  it("lee fechas ISO y españolas, y rechaza las imposibles", () => {
    expect(parseShortcutDate("2026-10-17")).toBe("2026-10-17");
    expect(parseShortcutDate("17/10/2026")).toBe("2026-10-17");
    expect(parseShortcutDate("7-1-2026")).toBe("2026-01-07");
    expect(parseShortcutDate("31/02/2026")).toBeNull();
    expect(parseShortcutDate("ayer")).toBeNull();
    expect(parseShortcutDate(null)).toBeNull();
  });
  it("hoy depende de la zona horaria", () => {
    const t = new Date("2026-10-31T23:30:00Z");
    expect(todayIn("Europe/Madrid", t)).toBe("2026-11-01");
    expect(todayIn("America/New_York", t)).toBe("2026-10-31");
  });
});

describe("atajo genérico: nombres de Wallet", async () => {
  const { matchWallet, walletNameMoves } = await import("../src/lib/quickadd");
  const cards = { k1: { name: "Tarjeta Cuenta *1425", walletNames: ["BBVA Crédito"] }, k2: { name: "Vieja", archived: true, walletNames: ["Antigua"] } };
  const accounts = { a1: { name: "Cuenta *1425", walletNames: ["BBVA Débito"] }, a2: { name: "N26" } };
  it("reconoce el nombre aprendido, sin mayúsculas ni tildes, y salta lo archivado", () => {
    expect(matchWallet(cards, accounts, "bbva credito")).toBe("card:k1");
    expect(matchWallet(cards, accounts, "BBVA Débito")).toBe("acc:a1");
    expect(matchWallet(cards, accounts, "Antigua")).toBeNull();
    expect(matchWallet(cards, accounts, "Revolut")).toBeNull();
  });
  it("recordar mueve el nombre a la nueva tarjeta o cuenta y lo quita de la anterior", () => {
    expect(walletNameMoves(cards, accounts, "Revolut", "acc:a2")).toEqual([["accounts", "a2", ["Revolut"]]]);
    expect(walletNameMoves(cards, accounts, "BBVA Débito", "card:k1")).toEqual([
      ["cards", "k1", ["BBVA Crédito", "BBVA Débito"]], ["accounts", "a1", []]]);
    expect(walletNameMoves(cards, accounts, "BBVA Débito", "acc:a1")).toEqual([]);
  });
});
