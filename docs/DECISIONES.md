# Registro de decisiones

Reglas de negocio aprobadas por Francisco. El código las cita por su identificador
(B1, D3…). **Cualquier cambio de cálculo que no esté aquí necesita su aprobación primero.**

> Origen: la especificación de la Fase 1 (secciones 5 «modelo de datos» y «registro de
> decisiones») se redactó fuera del repo y el código la referencia, pero **no está versionada**.
> Este fichero la reconstruye a partir de los commits, los README y las decisiones posteriores.
> Si aparece el documento original, súbelo a `docs/` y concilia ambos.

## Principio rector

**Port fiel primero, correcciones después.** El motor nuevo reproduce la app vieja bit a bit
(`LEGACY_OPTIONS`, Fase 4a) y cada corrección se activa con una opción (`CURRENT_OPTIONS`,
Fase 4b), con su test y con `npm run delta` para ver qué cifras reales cambia.

## Correcciones del motor (tras `EngineOptions`)

| Id | Opción | Regla |
| --- | --- | --- |
| B6 | `fixB6` | Un pago de un gasto fijo fuera de su periodo se ignora en todos los cálculos (antes restaba en el saldo real). |
| B1 | `fixB1` | Saldo proyectado de un mes futuro = proyectado de ese mes sobre el saldo proyectado del mes anterior (encadenado). Incluye fijos y budgets. |
| D3 + A1 | `fixD3` | Gastos propios: en meses cerrados se debe lo marcado pagado; en el actual y futuros, lo previsto. El pendiente se acumula hasta reembolsarse. El proyectado del mes actual resta todo el pendiente; el de cada mes futuro, lo de ese mes. El proyectado mostrado es lo que se arrastra. `settings.ownExpensesFrom` marca desde qué mes se controlan en la app. |
| Céntimos | `cents` | Cálculo en céntimos enteros; deducciones redondeadas al céntimo (mitades hacia arriba); reparto del déficit al céntimo, resto al último budget. |
| C | `perCardSettlement` | Los pagos de tarjeta se agrupan por **tarjeta** y mes de cargo (antes por cuenta y mes). Con una tarjeta por cuenta no cambia ninguna cifra. |
| D (19-oct-2026) | `incomeOffsetsBudget` | Un ingreso con la categoría de un budget activo **en la misma cuenta** es una devolución: resta del gasto de ese budget (puede dejarlo en negativo) y **deja de sumar como ingreso** en el proyectado, para no contarlo dos veces. Se reserva el mayor entre el budget y el gasto neto. Aplica a todos los meses (decisión de Francisco: «siempre»); el saldo real y el resultado real de los meses cerrados no cambian. Ingresos sin budget de su categoría, igual que antes. |

## Decisiones sin opción (comportamiento nuevo directo)

| Id | Regla |
| --- | --- |
| B3 | Budgets con `revisions`: nuevo importe a partir de un mes. Sin revisiones, igual que antes. |
| D5 | El mes actual se calcula en la zona horaria del usuario (`currentMonthInTimeZone`). Corrige el desfase de la app vieja. |
| D6 | Al registrar una compra con tarjeta se elige su mes de cobro (por defecto, el siguiente). |
| D8 | Las categorías **no tienen tipo y no afectan a ningún cálculo**. Siguen existiendo como etiqueta; un gasto puede ir sin categoría. (Antes solo «combustible» y «comida» tenían tratamiento; el resto era «extra».) |
| A (18-oct-2026) | Las deducciones de la nómina pueden cambiar **a partir de un mes** (`deductionRevisions`), sin alterar meses anteriores. |
| B (18-oct-2026) | El «gasto propio» de un gasto fijo puede cambiar a partir de un mes (`FixedRevision.isOwnExpense`). |
| — | Los gastos propios de cuentas secundarias **siempre se reembolsan desde la cuenta principal**. |
| — | Un gasto fijo **no marcado como pagado** en un mes cerrado significa que **ese mes no se pagó**. |
| — | Combustible (26-oct-2026): una categoría puede marcarse `isFuel` (sin marca, lo es si ya tiene repostajes migrados). Sus gastos guardan `fuel: { km, pricePerLiter }` como la app vieja; litros = importe / precio. Al apuntar se compara con la media de los últimos 5 repostajes con km. Un comercio nuevo con nombre de gasolinera propone esa categoría. **No afecta a ningún cálculo de dinero.** |
| — | «Este mes no hubo gasto» = pagado a 0 € (como en la app vieja): no resta, no deja reembolso de gasto propio pendiente y no cuenta como mes pagado en «Pagado desde el inicio». |
| — | El inicio del arrastre se liga a `settings.startMonth` (equivalente a `min_managed_month`). |
| — | Configuración explícita de tarjetas de crédito (`cards`: cuenta, corte, cobro, dónde se reserva). |
| — | Un gasto fijo puede, opcionalmente, contar dentro del budget de su categoría (`countsInBudget`, misma cuenta). Cuenta su importe pagado o, si no, el previsto, desde el día 1; se reserva max(budget, variable + fijo) sin duplicar el fijo. Con dos budgets de la misma categoría, solo en el primero. |
| — | Un gasto fijo con pagos no se borra: se termina. Editar el importe de un préstamo conserva lo devuelto. |

## Migración

- Se conservan los ids viejos (migración repetible, sin duplicados).
- No se recalcula nada: lo que el motor viejo deduce por defecto se materializa con el mismo resultado.
- Ningún campo se pierde: lo que no encaja va a `legacy` / `legacy.extra`.
- Datos ambiguos → error y parada sin escribir.
- Verificación: conteos, sumas por colección y mes, y el motor viejo ejecutado sobre origen y
  destino con igualdad exacta. Aceptación de referencias: diferencia ≤ 0,005 €.

## Histórico anterior a la app (Excel nov-2023 → feb-2026)

- **Opción A**: se importa en **cuentas archivadas propias** («Excel (hasta feb-2026)», «Excel: ahorros»,
  «Excel: Mami», «Excel: efectivo»). Ninguna cuenta real cambia; la verificación exige cifras
  idénticas con y sin histórico.
- Solo es gasto lo que suma la fórmula del total de cada lista; el efectivo sumado al total es
  transferencia; los cambios a mano en «Remain last month» entran como «Ajuste del remanente»;
  `TODAY()` se evalúa como en su mes; cada mes debe cuadrar al céntimo o no se escribe nada.
- Las correcciones manuales viven en un JSON **fuera del repo** (`~/salary-migration/history-fixes.json`).
- El detalle de qué hoja corresponde a qué cuenta real es dato personal: no va en este repo.
