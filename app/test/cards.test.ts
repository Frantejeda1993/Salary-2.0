import { describe, expect, it } from "vitest";
import { rechargePlan, summarizeMoves } from "../src/lib/cards";

const card = { accountId: "a1", cutoffDay: 25, chargeOffsetMonths: 1 };
const buy = (date: string, chargeMonth: string, amount = 10, cardId = "v") =>
  ({ type: "expense", date, amount, description: "Compra", accountId: "a1", card: { cardId, chargeMonth, reserveIn: "purchase" } });

describe("recalcular el mes de cobro al cambiar el corte", () => {
  it("lo comprado después del corte pasa al cobro siguiente (caso del 30 de octubre)", () => {
    const movs = { m1: buy("2026-10-30", "2026-11", 20), m2: buy("2026-10-20", "2026-11", 5), m3: buy("2026-10-31", "2026-11", 7.5) };
    const p = rechargePlan("v", card, movs, {}, "2026-11");
    expect(p.moves.map((m) => [m.id, m.from, m.to])).toEqual([["m1", "2026-11", "2026-12"], ["m3", "2026-11", "2026-12"]]);
    expect(summarizeMoves(p.moves)).toEqual([{ from: "2026-11", to: "2026-12", count: 2, cents: 2750 }]);
  });
  it("no toca cargos saldados ni los que irían a uno saldado", () => {
    const movs = { m1: buy("2026-10-30", "2026-11") };
    expect(rechargePlan("v", card, movs, { s: { cardId: "v", chargeMonth: "2026-11" } }, "2026-11")).toEqual({ moves: [], skippedSettled: 1 });
    expect(rechargePlan("v", card, movs, { s: { cardId: "v", chargeMonth: "2026-12" } }, "2026-11").skippedSettled).toBe(1);
  });
  it("no toca cargos de meses pasados, otras tarjetas, ni lo que ya cuadra", () => {
    const movs = { old: buy("2026-08-28", "2026-09"), other: buy("2026-10-30", "2026-11", 10, "otra"), ok: buy("2026-10-30", "2026-12"),
      inc: { type: "income", date: "2026-10-30", amount: 5 } };
    expect(rechargePlan("v", card, movs, {}, "2026-11").moves).toEqual([]);
  });
  it("también hacia atrás si el corte se adelanta o pasa a mes natural", () => {
    const movs = { m1: buy("2026-11-10", "2026-12") };
    expect(rechargePlan("v", { cutoffDay: 5, chargeOffsetMonths: 0 }, movs, {}, "2026-11").moves).toEqual([]);
    expect(rechargePlan("v", { cutoffDay: 20, chargeOffsetMonths: 0 }, movs, {}, "2026-11").moves[0].to).toBe("2026-11");
  });
});
