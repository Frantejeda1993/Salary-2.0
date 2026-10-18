/**
 * Informe de la Fase 4b: qué cifras cambia cada corrección sobre TUS datos.
 *
 *   npm run delta                 -> último real-*.json de ~/salary-migration/reference
 *   npm run delta -- <fichero>    -> otro fichero de referencia (también sirven los sintéticos)
 *   npm run delta -- <fichero> 2026-08   -> con otro "mes actual"
 *
 * Aplica las correcciones de una en una (acumuladas) y compara cada paso con el
 * anterior. Escribe todas las diferencias en un CSV junto al fichero de referencia.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  LEGACY_OPTIONS, engineMetrics, fromDataset, monthRange, type Dataset, type EngineOptions, type Metrics,
} from "../src";

const DIR = process.env.SALARY_REFERENCE_DIR ?? join(homedir(), "salary-migration", "reference");
const arg = process.argv[2];
const file = arg ?? (existsSync(DIR) ? readdirSync(DIR).filter((f) => /^real-.*\.json$/.test(f)).sort().map((f) => join(DIR, f)).at(-1) : undefined);
if (!file || !existsSync(file)) {
  console.error(`No encuentro el fichero de referencia${file ? `: ${file}` : ` en ${DIR}`}. Ejecuta antes 'python -m salary_migrate reference'.`);
  process.exit(1);
}
const ref = JSON.parse(readFileSync(file, "utf-8")) as { dataset: Dataset; cases: { currentMonth: string; startMonth: string; months: [string, string] }[] };
const wanted = process.argv[3];
const c = wanted ? ref.cases.find((x) => x.currentMonth === wanted) : ref.cases.at(-1);
if (!c) throw new Error(`No hay caso con mes actual ${wanted}`);

const steps: [string, Partial<EngineOptions>][] = [
  ["App vieja", {}],
  ["B6 · pagos fuera del periodo del fijo", { fixB6: true }],
  ["B1 · saldo proyectado de meses futuros", { fixB1: true }],
  ["D3+A1 · gastos propios", { fixD3: true }],
  ["Céntimos enteros", { cents: true }],
  ["C · pagos de tarjeta por tarjeta (debe dar 0 cambios)", { perCardSettlement: true }],
];

// Nombres legibles para cuentas, salarios, budgets y categorías (solo en tu terminal).
const names = new Map<string, string>();
const docs = ref.dataset.docs as unknown as Record<string, Record<string, { name?: string; categoryId?: string }>>;
for (const [id, a] of Object.entries(docs.accounts ?? {})) names.set(id, `cuenta ${a.name ?? id}`);
for (const [id, s] of Object.entries(docs.salaries ?? {})) names.set(id, `salario ${s.name ?? id}`);
for (const [id, k] of Object.entries(docs.categories ?? {})) names.set(id, `cat. ${k.name ?? id}`);
for (const [id, b] of Object.entries(docs.budgets ?? {})) names.set(id, `budget ${names.get(b.categoryId ?? "") ?? id}`);
const pretty = (key: string) => key.split("|").map((p) => names.get(p) ?? p).join(" · ");
const eur = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const months = monthRange(c.months[0], c.months[1]);
let opts: EngineOptions = { ...LEGACY_OPTIONS };
let prev: Metrics | null = null;
const csv = ["paso;clave;antes;despues;diferencia"];
const IMPORTANT = /\|summary\|(resultado_real|resultado_proyectado|remaining_from_previous_month|reembolsos_propios_pendientes)$|\|(real_balance|projected_balance)$/;

console.log(`Referencia: ${file}\nMes actual: ${c.currentMonth} · meses ${c.months[0]} … ${c.months[1]}\n`);
for (const [label, change] of steps) {
  opts = { ...opts, ...change };
  const data = fromDataset(ref.dataset, { cents: opts.cents });
  const cur = engineMetrics(data, c.currentMonth, c.startMonth, months, opts);
  if (prev) {
    const keys = [...new Set([...prev.keys(), ...cur.keys()])].sort();
    const changed = keys.filter((k) => prev!.get(k) !== cur.get(k));
    const visible = changed.filter((k) => Math.abs((cur.get(k) ?? 0) - (prev!.get(k) ?? 0)) >= 0.005);
    for (const k of changed) {
      const a = prev.get(k), b = cur.get(k);
      csv.push([label, pretty(k), a ?? "", b ?? "", a !== undefined && b !== undefined ? b - a : ""].join(";"));
    }
    console.log(`■ ${label}`);
    if (!changed.length) { console.log("   No cambia ninguna cifra.\n"); prev = cur; continue; }
    const maxd = Math.max(...changed.map((k) => Math.abs((cur.get(k) ?? 0) - (prev!.get(k) ?? 0))));
    console.log(`   ${changed.length} cifras cambian (${visible.length} en 1 céntimo o más). Cambio máximo: ${eur(maxd)} €`);
    const rows = visible.filter((k) => IMPORTANT.test(k)).slice(0, 30);
    for (const k of rows) {
      const a = prev.get(k), b = cur.get(k);
      console.log(`   ${pretty(k).padEnd(62)} ${eur(a).padStart(12)} → ${eur(b).padStart(12)}  (${b !== undefined && a !== undefined ? (b - a >= 0 ? "+" : "") + eur(b - a) : "nueva"})`);
    }
    if (visible.length > rows.length) console.log(`   … y ${visible.length - rows.length} cifras más en el CSV`);
    console.log("");
  }
  prev = cur;
}
const out = join(dirname(file), `delta-${c.currentMonth}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z.csv`);
writeFileSync(out, csv.join("\n"), "utf-8");
console.log(`Todas las diferencias: ${out}`);
