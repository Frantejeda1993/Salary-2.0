# Estado del proyecto

Actualizado: 18-oct-2026 (commit `1b4c729`).

## Fases

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Especificación: auditoría del motor viejo, modelo de datos nuevo, decisiones | Aprobada (documento fuera del repo, ver `DECISIONES.md`) |
| 2 | Script de backup, migración y verificación (`tools/migrate`) | Hecha |
| 3 | Valores de referencia con el motor viejo (`fixtures/reference`) | Hecha |
| 4a | Motor TypeScript, port 1:1 con bugs | Hecha |
| 4b | Correcciones acordadas tras opciones | Hecha |
| 5 | Esqueleto de la PWA (auth, datos, despliegue) | Hecha |
| 6 | Interfaz móvil completa: Mes, alta rápida, Movimientos, Plan editable, Ajustes, onboarding, tour, atajos Apple Pay | **Pendiente de validación de Francisco** |
| — | Decisiones A, B, C e importador del histórico Excel | Hechas (18-oct) |
| 7 | Migración final al uid real con `--prune` y retirada de la app vieja | Pendiente |
| 8a | Acceso por invitación: `allowlist` y `accessRequests` en Firestore, aprobación del administrador en Ajustes, invitar con el menú de compartir; recorridos e2e y tests de reglas en CI | Aprobada (1-nov) |
| 8b | Vincular dos cuentas (`pairs/{id}`, parejas de 2): invitar (pide también el acceso), aceptar/rechazar, cancelar, dejar de compartir; aviso en Mes | **Pendiente de aprobación** (1-nov) |
| 8c | Gastos compartidos: reparto fijo o por ingresos del mes, sección en Mes, saldar total/parcial, arrastre | Pendiente (diseño con ejemplos antes de programar) |
| 8d | App Android (envoltorio de la PWA + lectura de notificaciones elegidas), APK fuera de Play | Pendiente, después de 8c |

## Verificación a 18-oct-2026

- Motor: typecheck OK, 141 tests OK (`real.test.ts` se omite fuera del PC de Francisco).
- App: 58 tests OK.

## Pendientes y riesgos conocidos

1. **Validación de la Fase 6** con uso real en el iPhone antes de la migración final.
2. **Migración final (Fase 7)**: dejar de usar la app vieja durante la copia; `migrate` con uid
   real, `--prune`, `--history`, `--own-expenses-from`; exigir VERIFICACIÓN OK.
3. **Retirar `LEGACY_OPTIONS`** y el código de compatibilidad solo cuando la app nueva sea la única.
   Hasta entonces, no se toca.
4. **Multiusuario**: acceso por invitación hecho (8a). Faltan borrado de cuenta y datos por el propio
   usuario y vigilar el coste de Firebase si crece el número de usuarios.
5. **Especificación de Fase 1 no versionada**: el código la cita; si se recupera, añadirla a `docs/`.
