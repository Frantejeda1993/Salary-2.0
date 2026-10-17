/**
 * El motor TypeScript reproduce EXACTAMENTE (bit a bit) las cifras del motor
 * viejo en los ficheros de fixtures/reference/ (datos sintéticos, en el repo).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareMetrics, engineMetrics, fromDataset, monthRange, type Dataset } from "../src";

const DIR = join(__dirname, "..", "..", "fixtures", "reference");

interface RefFile {
  kind: string;
  dataset: Dataset;
  cases: { currentMonth: string; startMonth: string; months: [string, string]; metrics: Record<string, number> }[];
}

const files = readdirSync(DIR).filter((f) => /^synthetic-\d+\.json$/.test(f)).sort();

describe("fixtures sintéticos", () => {
  it("hay ficheros", () => expect(files.length).toBeGreaterThanOrEqual(12));

  for (const file of files) {
    const ref: RefFile = JSON.parse(readFileSync(join(DIR, file), "utf-8"));
    for (const c of ref.cases) {
      it(`${file} · mes actual ${c.currentMonth}`, () => {
        const data = fromDataset(ref.dataset);
        const got = engineMetrics(data, c.currentMonth, c.startMonth, monthRange(c.months[0], c.months[1]));
        const cmp = compareMetrics(c.metrics, got);
        expect(cmp.mismatches.slice(0, 5)).toEqual([]);
        expect(cmp.exact).toBe(cmp.compared);
      });
    }
  }
});
