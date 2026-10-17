# Valores de referencia (Fase 3)

Ficheros que fijan **qué debe calcular** el motor TypeScript de la Fase 4. Los
genera el motor de la app vieja (`services/finance_core.py` del repo `Salary`) y
son la definición operativa de "mismos resultados que la app actual".

## Qué hay en el repo y qué no

| Tipo | Contenido | Dónde |
| --- | --- | --- |
| `synthetic-*.json` | Datos inventados (`tools/migrate/salary_migrate/synthetic.py`), 12 semillas | **Aquí, en el repo (público)** |
| `real-*.json` | Tus datos tal cual | Solo en `~/salary-migration/reference/` |
| `anonymized-*.json` | Tus datos anonimizados | Solo en `~/salary-migration/reference/` |

El repo es **público**. Aunque la anonimización elimina textos y escala los
importes, conserva el calendario y las proporciones de tus gastos, así que no se
sube. La Fase 4 los usa en local con un test aparte, nunca en CI.

## Formato

```jsonc
{
  "format": "salary-reference/1",
  "kind": "synthetic" | "real" | "anonymized",
  "source": { "engineCommit": "…", "seed": 3 },
  "dataset": {
    "profile": { "settings": { "startMonth": "2026-02", "mainAccountId": "…" } },
    "docs": {                       // modelo nuevo, igual que users/{uid}/… en Firestore
      "accounts": { "<id>": {…} }, "categories": {…}, "salaries": {…}, "fixedExpenses": {…},
      "budgets": {…}, "movements": {…}, "cards": {…}, "cardSettlements": {…}
    }
  },
  "cases": [
    { "currentMonth": "2026-06", "startMonth": "2026-02", "months": ["2026-01", "2027-06"],
      "metrics": { "<clave>": <número>, … } }
  ],
  "coverage": { … }                 // qué escenarios contiene el fichero
}
```

`currentMonth` es el "mes actual" con el que se calcula. Cambia los resultados:
el arrastre de un mes cerrado es caja (real) y el de uno abierto, proyección.

## Claves de `metrics`

`m` = mes `YYYY-MM` dentro de `months`; `acc` = id de cuenta; `main` = cuenta principal.

| Clave | Función del motor viejo |
| --- | --- |
| `m\|summary\|<campo>` | `month_summary(m)`: `ingreso_total`, `gastos_fijos`, `presupuestos`, `gastos_reales`, `ingresos_extra`, `remaining_from_previous_month`, `resultado_real`, `resultado_proyectado`, `resultado_proyectado_pre_absorcion`, `deuda_tarjeta_arrastrada` |
| `m\|summary\|pending_loans_total` | Suma de pendientes de los préstamos recibidos por la principal |
| `m\|acc\|real_balance` | `real_balance(acc, m)` |
| `m\|acc\|projected_balance` | `projected_balance(acc, m).resultado` |
| `m\|acc\|card_outstanding_reserved` / `_all` | `credit_outstanding(acc, m, True / False)` |
| `m\|acc\|month_real` | `month_real_result(acc, m)` |
| `m\|acc\|month_projected` / `_pre` | `month_projected_result(acc, m, arrastre si acc es la principal, si no 0)` |
| `m\|acc\|card_debt_carried` | `…deuda_tarjeta_arrastrada` de lo anterior |
| `m\|acc\|budget\|<budgetId>\|<campo>` | `budget_details`: `presupuesto`, `real_spent`, `available`, `absorbed` |
| `m\|acc\|raw_category\|<catId>` | `raw_category_expenses(m, acc)` (`""` = sin categoría) |
| `m\|propios\|acc` | `propio_expenses_by_account(m, main)` |
| `m\|pending\|<tipo>` | `pending_obligations(m)` sumado por tipo (`Gasto fijo`, `Tarjeta`, `Reembolso propio`, `Préstamo`) |
| `m\|salary\|<salaryId>\|<campo>` | `salary_breakdown`: `base`, `atrasos`, `horas_extra`, `deducciones`, `neto` |
| `loans\|acc\|debes` / `te_deben` / `neto` | `pending_loans_impact(acc)` |
| `credit_group\|acc\|mesCargo\|total` / `settled` | `credit_groups()` |

Una clave ausente significa que el motor viejo no produce esa cifra (por
ejemplo, una categoría sin gasto ese mes). El motor nuevo no debe producirla
tampoco, o debe valer 0 y la comparación lo tratará como ausente; esto se fija
en la Fase 4.

## Reglas para reproducirlos exactamente (Fase 4a)

1. Recorrer cada colección **ordenada por id de documento**. Los pagos de un
   gasto fijo, por `legacyId` si existe y si no por mes. Los pagos de tarjeta,
   por `legacy.id` si existe y si no por id.
2. Sumar en el mismo orden que el código Python, sin reagrupar términos.
3. `currentMonth` y `startMonth` son parámetros; la lógica nunca lee el reloj.
4. Comparación: igualdad exacta como objetivo. Aceptación: diferencia ≤ 0,005 € en
   todas las claves, informando de la diferencia máxima.

## Regenerar

```bash
cd tools/migrate
python -m salary_migrate fixtures-synthetic --engine-path <ruta al repo Salary> --out ../../fixtures/reference
python -m pytest -q tests/test_reference.py      # comprueba que los del repo están al día
```

Tus ficheros reales, en tu ordenador:

```powershell
python -m salary_migrate reference --engine-path C:\dev\salary-legacy
```
