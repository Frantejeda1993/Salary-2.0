# Motor de cálculo

TypeScript puro, sin dependencias de interfaz ni de Firebase. Calcula salario neto,
resultado real y proyectado, arrastre entre meses, budgets y absorción de déficit,
saldos, tarjeta de crédito, gastos propios y préstamos a partir de los documentos del
modelo nuevo (`users/{uid}/…`).

## Estado: Fase 4b — correcciones acordadas, tras opciones

```ts
import { CURRENT_OPTIONS, FinanceCore, fromDataset } from "@salary/engine";
const data = fromDataset(dataset, { cents: true });          // importes en céntimos enteros
const core = new FinanceCore(data, currentMonthInTimeZone(tz), startMonth, CURRENT_OPTIONS);
core.monthSummary("2026-10").resultado_proyectado / 100;      // euros
```

| Opción | Corrección | Regla |
| --- | --- | --- |
| `fixB6` | B6 | Un pago de un gasto fijo fuera de su periodo se ignora en todos los cálculos. |
| `fixB1` | B1 | Saldo proyectado de un mes futuro = proyectado del mes aplicado sobre el saldo proyectado del mes anterior. |
| `fixD3` | D3 + A1 | Gastos propios: en meses cerrados se debe lo marcado pagado; en el actual y futuros, lo previsto. El pendiente se acumula hasta reembolsarse. El proyectado del mes actual resta todo el pendiente; el de cada mes futuro, lo de ese mes. El proyectado mostrado es lo que se arrastra. |
| `cents` | Céntimos | Importes en céntimos enteros; cada deducción se redondea al céntimo (mitades hacia arriba); el reparto del déficit, al céntimo con el resto en el último budget. |
| — | B3 | Budgets con `revisions` (nuevo importe a partir de un mes). Sin revisiones, igual que antes. |
| — | D5 | `currentMonthInTimeZone(tz)`: la app calcula el mes actual en la zona del usuario y se lo pasa al motor. |
| — | D8 | Las categorías no tienen tipo y no afectan a ningún cálculo (el motor ya no lo usaba). |

`LEGACY_OPTIONS` (todas desactivadas, en euros) reproduce exactamente la app vieja: lo
comprueban `test/reference.test.ts` y `test/real.test.ts`. Las opciones existen para
poder explicar qué cambia cada corrección; se retirarán cuando la app nueva sea la única.

### Qué cambia cada corrección en tus números

```bash
npm run delta     # usa tu último ~/salary-migration/reference/real-*.json
```

Aplica las correcciones una a una y lista las cifras que cambian (resultado real y
proyectado, arrastre, saldos), con el detalle completo en un CSV junto al fichero.

## Base: Fase 4a — port 1:1 de la app vieja

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

## Tests

```bash
npm ci
npm test          # reglas, correcciones y 12 ficheros sintéticos (igualdad exacta con la app vieja)
npm run test:real # tus datos: ~/salary-migration/reference/real-*.json (solo en tu ordenador)
```

| Fichero | Qué comprueba |
| --- | --- |
| `test/rules.test.ts` | Las reglas de negocio, portadas de los tests del repo viejo con los mismos datos |
| `test/reference.test.ts` | Todas las cifras de `fixtures/reference/synthetic-*.json`, bit a bit |
| `test/real.test.ts` | Lo mismo con tu fichero real y el anonimizado; se omite si no existen |
| `test/fixes.test.ts` | Una prueba por corrección (viejo vs corregido) e invariantes del motor corregido en los 12 sintéticos |
