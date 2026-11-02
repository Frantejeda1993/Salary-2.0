# Revisión de seguridad (3-nov-2026)

Revisión de Salary 2.0 contra una lista de 27 controles para apps hechas con IA. Muchos de esos
controles suponen un servidor propio con contraseñas, SQL, cookies y pagos. **Salary no tiene
nada de eso**: es una web estática (GitHub Pages) con login de Google (Firebase Auth) y datos en
Firestore protegidos por reglas. Cada punto dice si aplica, cómo está y qué se ha hecho.

Estado: ✅ correcto · 🔧 arreglado en esta revisión · 👤 lo tiene que hacer Francisco en una consola · ➖ no aplica.

| # | Control | Estado | Detalle |
| --- | --- | --- | --- |
| 1 | Autenticación bien configurada | ✅ 👤 | Solo Google, email verificado obligatorio, acceso por invitación (E1). **El punto débil es la cuenta de Google del administrador**: quien entre en ella administra la app. Hay que activar la verificación en dos pasos o una passkey. |
| 2 | Claves de API fuera del navegador | ✅ 👤 | La única clave del navegador es la web de Firebase, que es pública por diseño. Falta restringirla en Google Cloud (ver abajo). Las claves de administrador y de firma nunca han estado en el repo (comprobado con gitleaks en los 49 commits). |
| 3 | Proteger la base de datos | ✅ | Reglas cerradas por defecto: cada usuario solo su `users/{uid}`; parejas y gastos compartidos solo los dos miembros. Probadas contra el emulador en la CI. |
| 4 | Forzar HTTPS | ✅ | `*.github.io` sirve siempre HTTPS y está en la lista de precarga HSTS de los navegadores. La CSP añade `upgrade-insecure-requests`. |
| 5 | Contraseñas con hash | ➖ | No hay contraseñas: el login es con Google. 👤 Comprobar que en Authentication solo esté activado el proveedor Google. |
| 6 | Validar en el servidor | ✅ 🔧 | El «servidor» son las reglas: validan campos, importes y quién puede escribir qué. **Arreglado:** los textos que un usuario escribe y otro ve (nombre en la invitación, nota de la solicitud, nombre de la categoría compartida) ahora tienen límite de tamaño. |
| 7 | XSS | ✅ 🔧 | React escapa todo el texto; no hay `innerHTML` ni `dangerouslySetInnerHTML` ni enlaces construidos con datos de otros. **Añadida una Content-Security-Policy** que solo deja cargar código de la propia app y del login de Google. |
| 8 | Registrar y vigilar actividad sospechosa | ➖ | Sin servidor propio no hay registro de peticiones; lo que hay es el de Firebase (Authentication → Usuarios, último acceso). Con este número de usuarios no compensa más. Si crece, App Check (punto 12) es el siguiente paso. |
| 9 | Blindar las rutas de admin | ✅ | Lo de administrador (lista de invitados y solicitudes) lo protegen las reglas por email, no la interfaz: ocultar el botón no es la protección. |
| 10 | Consultas parametrizadas | ➖ | No hay SQL. Las consultas a Firestore no construyen texto con datos del usuario. |
| 11 | Variables de entorno | ✅ | No hay `.env` en el repo ni en el historial; el `.gitignore` los bloquea. |
| 12 | Límite de peticiones | 👤 | Firestore no limita por usuario. Con el plan gratuito (Spark), un abuso agota la cuota del día pero no genera coste. Protección real: **App Check** (propuesta, ver abajo). |
| 13 | Restringir CORS | ➖ | No hay API propia. La CSP limita a qué servidores puede conectarse la app (`connect-src`). |
| 14 | Cabeceras de seguridad | 🔧 | GitHub Pages no deja poner cabeceras. Se añade la CSP como `<meta>` y `Referrer-Policy`. Lo que un `<meta>` no puede hacer (impedir que otra web meta la app en un iframe) queda pendiente; el riesgo es bajo porque las acciones piden confirmación. |
| 15 | Cookies de sesión | ➖ | Firebase no usa cookies de sesión: guarda el token en el navegador y lo manda en cada petición. Lo protege la CSP (punto 7). |
| 16 | CSRF | ➖ | Sin cookies no hay CSRF: otra web no puede hacer peticiones con tu sesión. |
| 17 | Enlaces de recuperación que caducan | ➖ | No hay recuperación de contraseña (la gestiona Google). |
| 18 | Tipo y tamaño de archivos subidos | ➖ | La app no sube archivos. |
| 19 | Verificar precios y pagos en el servidor | ➖ | No hay pagos. Lo equivalente (importes de gastos compartidos que ve el otro) lo validan las reglas: positivos y con tope. |
| 20 | Modo debug apagado en producción | ✅ | Build de producción, sin mapas de código fuente ni `console.log`; el modo prueba (Firebase simulado) no entra en el build publicado. |
| 21 | Actualizar dependencias vulnerables | 🔧 | `npm audit`: 4 avisos altos en `@grpc/grpc-js` (dependencia de Firebase solo para Node, no está en la web). **Corregido**: Firebase 13.2 y grpc-js 1.14.7. Producción: 0 vulnerabilidades. Quedan avisos moderados en herramientas de compilación (workbox) y del emulador, solo en CI. **Nuevo**: Dependabot semanal y la CI falla si aparece una vulnerabilidad alta en producción. |
| 22 | Quitar paquetes que no se usan | ✅ | Comprobado con depcheck: ninguno sobra. |
| 23 | Archivos expuestos | ✅ | Lo publicado es solo el build (`index.html`, JS, CSS, fuentes, iconos, service worker). Ni fuentes ni datos. |
| 24 | Secretos en el historial de Git | ✅ 🔧 | gitleaks sobre los 49 commits: ninguna clave (solo la web de Firebase, pública). **Nuevo**: la CI escanea el historial en cada push. Datos personales: los tests usaban tu banco y los 4 últimos dígitos de una tarjeta; **sustituidos por datos inventados**. En el historial quedan esos dígitos, un nombre y un importe de un commit ya corregido (gravedad baja: ver abajo). |
| 25 | Revocar y cambiar claves comprometidas | ✅ 👤 | Ninguna clave comprometida. Higiene: borra `salary-android-secrets.txt` de `~/.salary-keys` (tiene las contraseñas en claro y ya están en GitHub) y guarda la `.jks` en tu gestor de contraseñas. |
| 26 | Revisión a fondo | ✅ | Esta revisión. Además: la app Android tiene la copia de seguridad desactivada, los avisos usan intents inmutables y lo que lee de las notificaciones se queda en el móvil. |
| 27 | Probar las protecciones | 🔧 | Reglas: tests contra el emulador en la CI (nuevos casos de tamaño). CSP: la app entera recorrida con la CSP de producción sin una sola violación. Falta probar el login real con Google con la CSP (no se puede desde el entorno de desarrollo): ver «Qué hacer ahora». |

## Qué hacer ahora (Francisco, ~20 minutos)

1. **Publicar las reglas nuevas**: Firebase Console → Firestore → Reglas → pegar `firestore.rules` → Publicar.
2. **Probar el login con la CSP** tras el despliegue: abre la app en una ventana de incógnito y entra con Google. Si falla, dímelo: se quita la CSP en un minuto.
3. **Verificación en dos pasos (o passkey)** en tu cuenta de Google y en GitHub. Son las dos llaves de todo: la primera administra la app y la segunda publica la web y firma el APK.
4. **Restringir la clave web** en Google Cloud Console → APIs y servicios → Credenciales → «Browser key» del proyecto `salary2-ee33e`:
   - Restricción de aplicación: *Sitios web* → `https://frantejeda1993.github.io/*` y `https://salary2-ee33e.firebaseapp.com/*`.
   - Restricción de API: *Identity Toolkit API*, *Token Service API* y *Cloud Firestore API*.
   - Después, prueba otra vez el login. Si algo falla, quita primero la restricción de API.
5. **Authentication** → Método de acceso: solo Google. Configuración → Dominios autorizados: `frantejeda1993.github.io` y `salary2-ee33e.firebaseapp.com` (quita `localhost` si no lo usas).
6. **Plan de Firebase**: si es Spark (gratis), un abuso no genera coste. Si algún día pasas a Blaze, crea una alerta de presupuesto.
7. Borrar `~/.salary-keys/salary-android-secrets.txt` (punto 25).

## Propuestas (no aplicadas)

- **App Check con reCAPTCHA**: hace que solo tu app (y no un script con la clave pública) pueda usar Firestore. Es el control que de verdad limita abusos (puntos 8 y 12). Requiere crear la clave de reCAPTCHA en la consola y un cambio pequeño en la app; conviene activarlo primero en modo «solo vigilar».
- **Reescribir el historial de Git** para borrar los 4 dígitos de la tarjeta, el nombre y el importe antiguos: no lo recomiendo. Es un `force push` que rompe cualquier copia del repo, GitHub puede seguir sirviendo los commits antiguos por su hash y lo expuesto tiene muy poco valor para un atacante (los 4 últimos dígitos salen en cualquier ticket).

## Cómo comprobar la CSP

Sin Firebase real: `cd app && npx vite build --config dev/vite.csp-check.config.ts`, servir `dist-csp` en `/Salary-2.0/` y recorrer la app; no debe aparecer ningún aviso «CSP» en la consola. Si se añade un servicio externo, su dominio va en `app/csp.ts`.
