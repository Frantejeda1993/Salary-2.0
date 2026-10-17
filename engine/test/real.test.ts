/**
 * Validación con TUS datos reales. Solo en tu ordenador: lee el fichero que generó
 * `python -m salary_migrate reference` en ~/salary-migration/reference/ (o en
 * SALARY_REFERENCE_DIR). Si no existe, el test se omite (por ejemplo en CI).
 *
 *   npm run test:real
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareMetrics, engineMetrics, fromDataset, monthRange } from "../src";

const DIR = process.env.SALARY_REFERENCE_DIR ?? join(homedir(), "salary-migration", "reference");
const latest = (prefix: string) =>
  existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().at(-1) : undefined;

for (const prefix of ["real-", "anonymized-"]) {
  const file = latest(prefix);
  describe.skipIf(!file)(`referencia ${prefix.slice(0, -1)} (${file ?? "no encontrada"})`, () => {
    const ref = file ? JSON.parse(readFileSync(join(DIR, file), "utf-8")) : { cases: [] };
    for (const c of ref.cases) {
      it(`mes actual ${c.currentMonth}`, () => {
        const got = engineMetrics(fromDataset(ref.dataset), c.currentMonth, c.startMonth, monthRange(c.months[0], c.months[1]));
        const cmp = compareMetrics(c.metrics, got);
        console.log(`${prefix}${c.currentMonth}: ${cmp.compared} cifras, ${cmp.exact} idénticas, ` +
          `diferencia máx. ${cmp.maxAbsDiff.toExponential(2)}${cmp.withinCent ? "" : " — FUERA DEL CÉNTIMO"}`);
        expect(cmp.mismatches.slice(0, 5)).toEqual([]);
      });
    }
  });
}
