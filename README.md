# Salary 2.0

Reconstrucción de la app de finanzas personales Salary (Streamlit) como PWA
instalable en móvil: React + Vite + Firebase (Auth con Google, Firestore con
caché offline), desplegada en GitHub Pages.

Estado: **Fase 6 — interfaz móvil completa (pendiente de tu validación).** Publicada en <https://frantejeda1993.github.io/Salary-2.0/>.

| Ruta | Contenido |
| --- | --- |
| [`app/`](app/) | La PWA: React + Vite, Firebase Auth (Google) y Firestore con caché offline |
| [`engine/`](engine/README.md) | Motor de cálculo en TypeScript puro (Fase 4) |
| [`fixtures/reference/`](fixtures/reference/README.md) | Valores de referencia sintéticos (Fase 3) |
| [`tools/migrate/`](tools/migrate/README.md) | Script de backup, migración y verificación desde la Firestore vieja |
| [`firestore.rules`](firestore.rules) | Reglas de seguridad: cada usuario solo accede a `users/{uid}/…` |

## Seguridad

- Nunca se suben claves de service account ni datos reales: ver `.gitignore`.
- Las claves viven en `~/.salary-keys/`; los backups e informes en `~/salary-migration/`.
- Las reglas de Firestore están cerradas desde el primer despliegue.

## Desarrollo

```bash
cd app
npm ci
npm run dev:mock   # Firebase simulado: datos solo en el navegador, sin tocar tu proyecto
npm run dev        # contra Firebase real (salary2-ee33e)
npm test && npm run build
```

En modo prueba, Ajustes → «Cargar datos de ejemplo» carga un dataset sintético.
