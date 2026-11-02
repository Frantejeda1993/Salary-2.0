# Estado del proyecto

Actualizado: 2-nov-2026.

## Fases

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Especificación: auditoría del motor viejo, modelo de datos nuevo, decisiones | Aprobada (documento fuera del repo, ver `DECISIONES.md`) |
| 2 | Script de backup, migración y verificación (`tools/migrate`) | Hecha |
| 3 | Valores de referencia con el motor viejo (`fixtures/reference`) | Hecha |
| 4a | Motor TypeScript, port 1:1 con bugs | Hecha |
| 4b | Correcciones acordadas tras opciones | Hecha |
| 5 | Esqueleto de la PWA (auth, datos, despliegue) | Hecha |
| 6 | Interfaz móvil completa: Mes, alta rápida, Movimientos, Plan editable, Ajustes, onboarding, tour, atajos Apple Pay | Validada en uso real |
| — | Decisiones A, B, C e importador del histórico Excel | Hechas (18-oct) |
| 7 | Migración final al uid real y retirada de la app vieja | Hecha: Salary 2.0 es la app oficial desde octubre de 2026 |
| 8a | Acceso por invitación: `allowlist` y `accessRequests` en Firestore, aprobación del administrador en Ajustes, invitar con el menú de compartir; recorridos e2e y tests de reglas en CI | Aprobada (1-nov) |
| 8b | Vincular dos cuentas (`pairs/{id}`, parejas de 2): invitar (pide también el acceso), aceptar/rechazar, cancelar, dejar de compartir; aviso en Mes | Aprobada (2-nov) |
| 8c | Gastos compartidos: marcar al apuntar, reparto a medias / porcentaje / por ingresos, sección en Mes con arrastre, saldar con confirmación, «¿con qué pagaste?», motor (E7–E12) | **Programada, pendiente de aprobación** (2-nov). Requiere publicar `firestore.rules` |
| 8d | App Android (envoltorio de la PWA + lectura de notificaciones elegidas), APK fuera de Play | Pendiente, después de 8c |

## Verificación a 2-nov-2026

- Motor: typecheck OK, 170 tests OK (24 nuevos de gastos compartidos; `real.test.ts` solo en el PC de Francisco).
- App: 88 tests OK (12 nuevos), build OK, 16 recorridos e2e OK (4 nuevos de gastos compartidos).
- Reglas de Firestore: tests en `rules-tests/` (solo en CI: el emulador no se descarga aquí).

## Pendientes y riesgos conocidos

1. **Aprobar la 8c** y las decisiones E8 (saldar siempre por la cuenta principal) y E9 (qué ingresos cuentan para el reparto).
2. **Publicar `firestore.rules`** en Firebase Console: sin eso, apuntar un gasto compartido da «permiso denegado».
3. **8d (Android)**: diseño y decisiones abiertas antes de programar.
4. **Retirar `LEGACY_OPTIONS`** y el código de compatibilidad cuando ya no haga falta comparar con la app vieja.
5. **Multiusuario**: faltan borrado de cuenta y datos por el propio usuario, y vigilar el coste de Firebase.
6. **Especificación de Fase 1 no versionada**: el código la cita; si se recupera, añadirla a `docs/`.
