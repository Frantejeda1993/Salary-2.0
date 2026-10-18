# CLAUDE.md — Salary 2.0

Reconstrucción de **Salary** (app de finanzas personales en Python + Streamlit + Firestore,
repo `Frantejeda1993/Salary`) como **PWA móvil multiusuario**: React 19 + Vite + Firebase
(Auth con Google, Firestore con caché offline), publicada en GitHub Pages:
<https://frantejeda1993.github.io/Salary-2.0/>. Proyecto Firebase: `salary2-ee33e`.

El dueño (Francisco) usa la app vieja **a diario** con sus datos reales. Todo lo que hagas
debe permitir migrar esos datos de forma verificable y sin perder ni alterar una sola cifra.

Idioma: **español** en código (comentarios, nombres de UI), commits, docs y respuestas.

---

## Objetivos del producto (por este orden)

1. **Mismas cifras que la app vieja**, salvo las correcciones acordadas (ver `docs/DECISIONES.md`).
2. **Registrar un gasto en menos de 5 segundos** (botón «+», atajos de iOS/Apple Pay vía `#/nuevo?…`).
3. **Onboarding sencillo** para usuarios nuevos (multiusuario).
4. **Migración verificable** de los datos reales: igualdad exacta mes a mes, repetible.

## Reglas innegociables

- **El repo `Salary` y su Firestore son solo lectura.** Nunca escribas en ellos. El motor viejo
  (`services/finance_core.py`, commit `b93f352`) solo se lee/ejecuta para comparar.
- **Este repo es PÚBLICO.** Nunca subas claves de service account, `.env`, backups, informes,
  ficheros `real-*.json`/`anonymized-*.json`, el Excel histórico ni importes/nombres reales
  (tampoco en tests, docstrings, ejemplos ni mensajes de commit). Ejemplos: importes inventados.
  - Claves: `~/.salary-keys/`. Backups, informes y referencias reales: `~/salary-migration/`.
  - La config web de Firebase en `app/src/firebase.ts` es pública por diseño; la seguridad la dan
    las reglas.
- **Trabajo por fases, con aprobación al final de cada una.** No empieces la fase siguiente ni
  cambies el alcance sin que Francisco lo apruebe.
- **Reglas de negocio ambiguas: se proponen, no se deciden.** Ante una duda sobre cómo debe
  calcularse algo, explica opciones con su impacto en cifras y espera la decisión. Nunca
  «arregles» en silencio un comportamiento del motor viejo.
- **Cada corrección de cálculo va tras una opción del motor** (`EngineOptions`), en su propio
  commit, con su test «viejo vs corregido». `LEGACY_OPTIONS` debe seguir reproduciendo la app
  vieja bit a bit hasta que la app nueva sea la única.
- **Ante datos ambiguos en la migración: error y parada, nunca arreglo silencioso.**
- Cambios que afectan a **meses cerrados** se avisan explícitamente en la UI.

## Mapa del repo

| Ruta | Qué es |
| --- | --- |
| `engine/` | Motor de cálculo, TypeScript puro sin UI ni Firebase. `@salary/engine`. Ver `engine/README.md`. |
| `engine/src/core.ts` | `FinanceCore`: port 1:1 de `finance_core.py` + correcciones tras `EngineOptions`. |
| `engine/src/model.ts` | Tipos de los documentos Firestore (modelo nuevo). |
| `engine/src/data.ts` | `fromDataset(ds, { cents })`: documentos → datos del motor. |
| `engine/src/pymath.ts` | `pySum` (suma compensada de Neumaier, como `sum()` de Python ≥3.12). |
| `engine/scripts/delta.ts` | `npm run delta`: qué cifras reales cambia cada corrección (solo en el PC de Francisco). |
| `app/` | La PWA. `src/data.tsx` (datos en tiempo real + motor), `src/auth.tsx` (login y perfil), `src/pages/` (Mes, Movimientos, Plan, Ajustes, Onboarding), `src/components/` (QuickAdd, PlanEditors…), `src/lib/` (lógica pura y testeable). |
| `app/dev/` | Modo `dev:mock`: Firebase simulado en el navegador. |
| `fixtures/reference/` | 12 ficheros sintéticos con todas las cifras del motor viejo. Definición operativa de «mismos resultados». |
| `tools/migrate/` | Python: backup, migración, verificación, referencias e importador del Excel histórico. Ver su README. |
| `firestore.rules` | Cerradas: solo emails invitados, solo `users/{uid}/…`; `meta/` solo la escribe el script. |
| `docs/DECISIONES.md` | Registro de decisiones de negocio (léelo antes de tocar cálculos). |
| `docs/ESTADO.md` | Fases, estado actual y pendientes. |

## Modelo de datos (Firestore)

Todo bajo `users/{uid}`:
- Perfil `users/{uid}`: `displayName`, `onboardingDone`, `tourDone`, `settings` (`startMonth`,
  `mainAccountId`, `ownExpensesFrom`, `timezone`, `currency`, `locale`, `features`).
- Colecciones: `accounts`, `cards`, `categories`, `salaries`, `fixedExpenses`, `budgets`,
  `movements` (`type`: expense/income/transfer; `transferKind`: normal/loan/loanRepayment/ownExpenseRefund),
  `cardSettlements` (id `{cardId}_{AAAA-MM}`), `meta` (traza de migración, solo lectura en la app).
- Revisiones «a partir del mes X» en nómina (`revisions`, `deductionRevisions`), gastos fijos
  (`revisions`, incluido `isOwnExpense`) y budgets (`revisions`). Un cambio programado no
  reescribe meses anteriores.
- Pagos de un gasto fijo: `payments[AAAA-MM] = { status: "paid" | "unpaid", amount }`.
- Campos sin sitio en el modelo nuevo se conservan en `legacy` / `legacy.extra`.

Tipos exactos: `engine/src/model.ts`. Correspondencia viejo → nuevo: `tools/migrate/README.md`.

## Invariantes técnicos (romperlos rompe la igualdad exacta)

- **Firestore guarda euros; el motor calcula en céntimos enteros** (`fromDataset(ds, { cents: true })`,
  `formatCents` en la UI). Redondeo de deducciones al céntimo, mitades hacia arriba; reparto de
  déficit al céntimo con el resto en el último budget.
- En el port 1:1: cada `sum(...)` de Python es `pySum(...)`, cada `+=` es `+=`; dicts → `Map`;
  colecciones recorridas **ordenadas por id de documento**. No reordenes ni reagrupes sumas.
- **El motor nunca lee el reloj.** `currentMonth` y `startMonth` son parámetros; la app calcula
  el mes actual con `currentMonthInTimeZone(tz)` (zona del usuario, por defecto `Europe/Madrid`).
- Toda la app lee cifras de un único `FinanceCore` (`useData().core`) con `CURRENT_OPTIONS`.
  No recalcules importes en componentes: añade la función al motor y su test.
- Lógica de UI no trivial va en `app/src/lib/*.ts` (pura, sin Firebase) con test en `app/test/`.

## Comandos

```bash
# Motor
cd engine && npm ci && npm run typecheck && npm test
npm run test:real     # solo con ~/salary-migration/reference/real-*.json (PC de Francisco)
npm run delta         # impacto de cada corrección en sus datos reales

# App
cd app && npm ci
npm run dev:mock      # Firebase simulado; Ajustes → «Cargar datos de ejemplo» (sintéticos)
npm run dev           # contra Firebase real salary2-ee33e — evitar salvo petición expresa
npm test && npm run build   # build = tsc --noEmit + vite build

# Migración (Python 3.12)
cd tools/migrate && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
SALARY_LEGACY_PATH=<ruta al repo Salary> python -m pytest -q
```

CI (`.github/workflows/tests.yml`): motor (typecheck + tests), app (tests + build) y migración
(pytest contra el repo viejo en `b93f352`). `deploy.yml` publica en Pages en cada push a `main`
que toque `app/**` o `engine/src/**`: **un push a main es un despliegue a producción**.

## Cómo trabajar aquí

- **Antes de terminar una tarea**: `npm test` en `engine/` y `app/`, `npm run build` en `app/`,
  y `pytest` en `tools/migrate/` si lo tocaste. No des nada por hecho sin ejecutarlo.
- Si tocas el motor: los 12 sintéticos deben seguir pasando con `LEGACY_OPTIONS` (igualdad
  exacta) y los invariantes de `test/fixes.test.ts` con `CURRENT_OPTIONS`.
- Si cambias el modelo de datos: actualiza a la vez `engine/src/model.ts`, `fromDataset`,
  `tools/migrate` (transform + verify), `app/dev/mocks` si aplica, y propón la migración de
  documentos existentes. Nunca un cambio de esquema solo en un lado.
- Francisco ejecuta la migración en **Windows con PowerShell**: da comandos de una línea para
  PowerShell (sin `\` de continuación), rutas tipo `C:\dev\…`, y ten en cuenta BOM en JSON.
- Nunca pidas ni pegues contenido de ficheros con datos reales; pide la salida de terminal
  (conteos, cuadres), que es lo que el tooling está diseñado para mostrar.
- UI: móvil primero (iPhone PWA: notch, teclado iOS, objetivos de 44 px, contraste AA,
  tema claro/oscuro del sistema). Textos de interfaz en español, tuteo, sin jerga contable.
- Commits pequeños, en español, describiendo el «qué» y el porqué de negocio.

## Multiusuario: lo que falta (no lo des por resuelto)

El acceso hoy es una **lista blanca de emails en `firestore.rules`** (`invited()`), con un solo
email. «Multiusuario» funciona a nivel de datos (cada uno en su `users/{uid}`) y de onboarding,
pero añadir un usuario exige editar y publicar las reglas a mano. Cualquier propuesta de
invitaciones/registro abierto debe tratar: coste de Firebase, abuso, borrado de cuenta y datos,
y que las reglas sigan cerradas por defecto. Propónlo; no lo implementes sin aprobación.
