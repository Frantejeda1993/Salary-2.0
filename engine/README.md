# Motor de cálculo

TypeScript puro, sin dependencias de interfaz ni de Firebase. Calcula salario neto,
resultado real y proyectado, arrastre entre meses, budgets y absorción de déficit,
saldos, tarjeta de crédito, gastos propios y préstamos a partir de los documentos del
modelo nuevo (`users/{uid}/…`).

## Estado: Fase 4a — port 1:1 de la app vieja

`src/core.ts` es una traducción línea a línea de `services/finance_core.py`
(repo `Frantejeda1993/Salary`, commit `b93f352`), **con sus bugs**. Reproduce las cifras
del motor viejo bit a bit. Las correcciones acordadas llegan en la Fase 4b, una por
commit, cada una con su test.

Dos detalles imprescindibles para la igualdad exacta:

- **`sum()` de Python ≠ `+`.** Desde Python 3.12, `sum()` usa suma compensada de
  Neumaier; `+=` no. Cada `sum(...)` del código viejo es `pySum(...)` aquí
  (`src/pymath.ts`) y cada `+=` es `+=`.
- **Orden.** Las colecciones se recorren ordenadas por id de documento y los dict de
  Python son `Map` (orden de inserción). El orden fija las sumas y el reparto de la
  absorción de déficit.

## Uso

```ts
import { FinanceCore, fromDataset } from "@salary/engine";
const core = new FinanceCore(fromDataset(dataset), "2026-10", dataset.profile.settings.startMonth);
core.monthSummary("2026-10").resultado_proyectado;
```

## Tests

```bash
npm ci
npm test          # reglas portadas de los tests de Python + 12 ficheros sintéticos (igualdad exacta)
npm run test:real # tus datos: ~/salary-migration/reference/real-*.json (solo en tu ordenador)
```

| Fichero | Qué comprueba |
| --- | --- |
| `test/rules.test.ts` | Las reglas de negocio, portadas de los tests del repo viejo con los mismos datos |
| `test/reference.test.ts` | Todas las cifras de `fixtures/reference/synthetic-*.json`, bit a bit |
| `test/real.test.ts` | Lo mismo con tu fichero real y el anonimizado; se omite si no existen |
