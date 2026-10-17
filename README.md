# Salary 2.0

Reconstrucción de la app de finanzas personales Salary (Streamlit) como PWA
instalable en móvil: React + Vite + Firebase (Auth con Google, Firestore con
caché offline), desplegada en GitHub Pages.

Estado: **Fase 2 — migración de datos.**

| Ruta | Contenido |
| --- | --- |
| [`tools/migrate/`](tools/migrate/README.md) | Script de backup, migración y verificación desde la Firestore vieja |
| [`firestore.rules`](firestore.rules) | Reglas de seguridad: cada usuario solo accede a `users/{uid}/…` |

## Seguridad

- Nunca se suben claves de service account ni datos reales: ver `.gitignore`.
- Las claves viven en `~/.salary-keys/`; los backups e informes en `~/salary-migration/`.
- Las reglas de Firestore están cerradas desde el primer despliegue.
