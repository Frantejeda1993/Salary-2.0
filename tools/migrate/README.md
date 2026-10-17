# Migración Salary → Salary 2.0

Script que copia tus datos de la Firestore de la app vieja (Streamlit) a la
Firestore nueva (`salary2-ee33e`), bajo `users/{uid}/...`. Sirve para las
pruebas y para la migración final.

Qué hace en cada ejecución, en este orden:

1. **Lee la base vieja en solo lectura** y guarda un **backup JSON** completo
   (con su `sha256`) antes de hacer nada más.
2. **Transforma** desde ese backup al modelo nuevo. Si encuentra datos ambiguos
   (dos cuentas principales, un gasto fijo pagado dos veces el mismo mes, una
   deuda de tarjeta saldada dos veces…) **se detiene sin escribir nada** y te lo lista.
3. Calcula el **plan**: qué crearía, actualizaría, dejaría igual o borraría.
   Con `--dry-run` se queda aquí.
4. **Escribe** en la base nueva. Es **repetible**: los ids son los de la base
   vieja, así que ejecutarlo dos veces no duplica nada; la segunda vez solo actualiza la traza `meta/migration`.
5. **Verifica** origen contra destino: conteos por colección, número y suma de
   importes por colección y mes, y —con `--engine-path`— ejecuta **el motor de
   cálculo de la app vieja** sobre ambos y compara todas las cifras mes a mes
   (real, proyectado, arrastre, budgets, saldos, tarjeta, salarios…).
   Exige igualdad exacta.

Lo que nunca hace:

- Escribir en la base vieja (además del código, la clave que usarás no tiene permiso).
- Sobrescribir un documento que hayas editado en la app nueva (salvo `--overwrite-edited`).
- Tocar documentos creados en la app nueva.
- Borrar nada del destino salvo que pases `--prune` (o uses `wipe`).

---

## 1. Preparación (una sola vez)

### 1.1 Requisitos
- Python 3.10 o superior.
- Git.

### 1.2 Carpeta para las claves (fuera del repo)

```bash
mkdir -p ~/.salary-keys
chmod 700 ~/.salary-keys        # macOS / Linux
```

> Las claves dan acceso total o de lectura a tus datos. No las subas a ningún
> sitio, no las pegues en chats y no las guardes dentro del repo.

### 1.3 Clave de **solo lectura** del proyecto viejo

No uses la clave de "Firebase Admin SDK" que tiene la app vieja en sus secrets:
esa puede escribir. Crea una nueva que solo pueda leer:

1. Abre <https://console.cloud.google.com/iam-admin/serviceaccounts> y selecciona
   el **proyecto de la app vieja** (el `project_id` que aparece en los secrets de Streamlit).
2. **Crear cuenta de servicio** → nombre `salary-migration-readonly` → Crear y continuar.
3. Rol: **Cloud Datastore Viewer** (`roles/datastore.viewer`). Ningún otro → Listo.
4. Abre la cuenta creada → pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → JSON.
5. Mueve el fichero descargado a `~/.salary-keys/old-readonly.json`.

### 1.4 Clave del proyecto nuevo `salary2-ee33e`

1. Firebase Console → proyecto `salary2-ee33e` → **Firestore Database**: si no
   está creada, créala en modo **producción** (región `eur3` o `europe-southwest1`).
2. ⚙ **Configuración del proyecto** → **Cuentas de servicio** → **Generar nueva clave privada**.
3. Mueve el fichero a `~/.salary-keys/salary2-admin.json`.

### 1.5 Publica las reglas cerradas ANTES de copiar datos reales

Firebase Console → `salary2-ee33e` → Firestore Database → **Reglas** → pega el
contenido de [`firestore.rules`](../../firestore.rules) del repo → **Publicar**.

Así, desde el primer dato, nadie salvo tu email (y solo en `users/{tu-uid}`) puede leer nada.
El script usa la clave de administrador, que no pasa por las reglas.

### 1.6 Código y entorno

```bash
git clone https://github.com/Frantejeda1993/Salary-2.0.git
git clone https://github.com/Frantejeda1993/Salary.git salary-legacy   # solo para leer su motor de cálculo
cd Salary-2.0/tools/migrate
python3 -m venv .venv
source .venv/bin/activate          # Windows (PowerShell): .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest -q                # deben pasar todos (usa SALARY_LEGACY_PATH, ver abajo)
```

Para que los tests usen el motor viejo:

```bash
export SALARY_LEGACY_PATH=../../../salary-legacy     # Windows: $env:SALARY_LEGACY_PATH="..\..\..\salary-legacy"
python -m pytest -q
```

### 1.7 Tu `min_managed_month`

La app vieja empieza el arrastre en ese mes. Para saber cuál tienes:
abre la app vieja → **Monthly View** → elige el mes más antiguo de la lista. Si
es anterior o igual al inicio, aparece el aviso *"Mes anterior o igual al inicio de
gestión (AAAA-MM)"*: ese AAAA-MM es tu valor. Si ningún mes muestra el aviso,
dímelo: significa que el valor es anterior a tus datos y lo resolvemos con el inventario.

---

## 2. Inventario (solo lectura)

```bash
python -m salary_migrate inventory \
  --source-key ~/.salary-keys/old-readonly.json \
  --min-month 2026-02
```

Muestra cuántos documentos hay por colección, el rango de meses, la cuenta
principal y los errores y avisos que tendría la migración. Guarda el backup en
`~/salary-migration/backups/` y el informe en `~/salary-migration/reports/`.

**Envíame la salida de la terminal** (no el fichero de backup). Contiene conteos,
ids y nombres de campos, no importes ni descripciones.

## 3. Migración de prueba

Usa un uid ficticio, por ejemplo `prueba-migracion`: con las reglas cerradas
nadie puede verlo desde la app, y lo podrás borrar al final.

```bash
# 3.1 Ensayo: no escribe nada en el destino
python -m salary_migrate migrate \
  --source-key ~/.salary-keys/old-readonly.json \
  --target-key ~/.salary-keys/salary2-admin.json \
  --uid prueba-migracion --min-month 2026-02 \
  --engine-path ../../../salary-legacy \
  --dry-run

# 3.2 Migración real al uid de prueba (mismo comando sin --dry-run)
python -m salary_migrate migrate \
  --source-key ~/.salary-keys/old-readonly.json \
  --target-key ~/.salary-keys/salary2-admin.json \
  --uid prueba-migracion --min-month 2026-02 \
  --engine-path ../../../salary-legacy

# 3.3 Repetible: vuelve a ejecutarlo. Debe decir "crear 0 · actualizar 0" y VERIFICACIÓN OK.
```

Debe terminar en **VERIFICACIÓN OK**. Si dice FALLIDA, envíame la salida.

Puedes revisar los datos en Firebase Console → Firestore → `users/prueba-migracion`.

Verificar más tarde contra un backup concreto:

```bash
python -m salary_migrate verify \
  --target-key ~/.salary-keys/salary2-admin.json --uid prueba-migracion \
  --min-month 2026-02 --engine-path ../../../salary-legacy \
  --backup ~/salary-migration/backups/backup-XXXX.json
```

Borrar la copia de prueba (solo el destino, solo ese uid):

```bash
python -m salary_migrate wipe --target-key ~/.salary-keys/salary2-admin.json \
  --uid prueba-migracion --confirm prueba-migracion
```

## 4. Migración final (Fase 7)

Mismo comando con tu **uid real** (lo mostrará la app nueva en tu perfil tras
el primer login con Google) y `--prune`, para que el destino sea un espejo exacto
del origen. Antes, deja de usar la app vieja para que no entren datos durante la copia.

## Opciones

| Opción | Para qué |
| --- | --- |
| `--dry-run` | Calcula y muestra el plan sin escribir en el destino (el backup sí se hace). |
| `--engine-path` | Ruta al repo viejo: compara todas las cifras con su motor de cálculo. Recomendado siempre. |
| `--current-month AAAA-MM` | Mes "actual" para la verificación. Por defecto, hoy en Madrid. |
| `--prune` | Borra del destino los documentos migrados antes que ya no existen en el origen. |
| `--overwrite-edited` | Sobrescribe también los documentos que se editaron en la app nueva. |
| `--from-backup FICHERO` | Migra desde un backup ya hecho, sin leer el origen. |
| `--backup-dir`, `--reports-dir` | Por defecto `~/salary-migration/backups` y `~/salary-migration/reports`. |

Códigos de salida: `0` correcto, `1` verificación fallida, `2` datos no migrables (no se escribió nada), `3` uso incorrecto.

## Correspondencia de datos

Ver la especificación de la Fase 1, sección 5.3. Resumen:

| Viejo | Nuevo (`users/{uid}/…`) |
| --- | --- |
| `accounts` + `banks` | `accounts` (nombre del banco copiado en `bankName`) |
| `categories` | `categories` (sin tipo; el viejo queda en `legacy.kind`) |
| `salaries` + `overtimes` | `salaries` (deducciones, revisiones y horas extra embebidas) |
| `fixed_expenses` + `fixed_expense_instances` | `fixedExpenses` (pagos en `payments[AAAA-MM]`) |
| `budgets` | `budgets` |
| `expenses` / `incomes` / `transfers` | `movements` (`type` = expense / income / transfer) |
| `credit_settlements` | `cardSettlements/{cardId}_{AAAA-MM}` |
| — | `cards` (una por cuenta con compras a crédito) |
| cuenta con `is_main` | `users/{uid}.settings.mainAccountId` |
| `min_managed_month` | `users/{uid}.settings.startMonth` |
| `monthly_account_snapshots` | solo en el backup |

Todo campo que no tiene sitio en el modelo nuevo se guarda en `legacy` del
documento: no se pierde nada.
