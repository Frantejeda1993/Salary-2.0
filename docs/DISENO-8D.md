# Fase 8d — Android: diseño para aprobar

Estado: **propuesta** (2-nov-2026). Nada programado. Objetivo: que tus amigos con Android
apunten un gasto en menos de 5 segundos, como el atajo de Apple Pay en iPhone.

## 1. Idea en una frase

Una app Android mínima que **envuelve la PWA** (la misma app, sin duplicar código) y **escucha
las notificaciones de pago** que el usuario elija; al ver un pago, muestra un aviso «12,50 € en
Mercadona: toca para apuntar» que abre el alta rápida **ya rellena**, exactamente como el atajo
de iPhone (`#/nuevo?importe=…&comercio=…&wallet=…`). Nada se guarda sin que el usuario confirme.

## 2. Por qué así (y no otras opciones)

| Opción | Problema |
| --- | --- |
| **TWA (Trusted Web Activity) + lector de notificaciones** (propuesta) | Usa Chrome por debajo: el inicio de sesión con Google funciona, la caché offline y las actualizaciones son las de la web. La parte nativa es pequeña (lector + aviso) y casi nunca cambia. |
| WebView propio (Capacitor, etc.) | Google **bloquea** el inicio de sesión de Google dentro de un WebView. Habría que añadir login nativo de Firebase: más código y más que mantener. |
| Guardar el gasto automáticamente, sin confirmar | La app nativa necesitaría su propia sesión de Firebase y escribir sin que lo veas. Un fallo al leer la notificación (importe o comercio mal leído) acabaría en tus cifras sin que lo notes. Va contra «mismas cifras, nada en silencio». |
| Publicar en Google Play | 25 € de cuenta de desarrollador y una revisión específica para apps que leen notificaciones. Para unos amigos no compensa; se instala el APK a mano. |

## 3. Cómo funciona para el usuario

1. Instala el APK (enlace desde Ajustes → Android). Android pide permitir «orígenes desconocidos».
2. Abre la app: es Salary, igual que en el navegador, con su sesión de Google.
3. En Ajustes → «Apuntar desde notificaciones», activa el permiso «Acceso a notificaciones» y
   elige de qué apps leer (por defecto, solo Google Wallet).
4. Paga con el móvil o la tarjeta: llega «12,50 € en Mercadona · toca para apuntar». Al tocar,
   se abre el alta con importe, comercio y tarjeta (la app aprende qué tarjeta de Wallet es
   cada cuenta, como ya hace el atajo de iPhone). Revisa y guarda.

Si el lector no entiende una notificación, no hace nada (no inventa importes).

## 4. Qué se lee y qué no

- Solo notificaciones de las apps que el usuario marca. Ninguna se guarda ni sale del móvil:
  el importe y el comercio viajan en el enlace que abre la app en el propio teléfono.
- Google Wallet tiene un formato estable para cualquier banco. Las apps de cada banco cambian
  de formato sin avisar: se añadirían una a una, con ejemplos reales.

## 5. Decisiones que necesito de ti

| # | Decisión | Propuesta |
| --- | --- | --- |
| D1 | ¿Confirmar cada gasto o guardar solo? | **Confirmar** (como en iPhone). |
| D2 | ¿De qué apps leer al principio? | **Solo Google Wallet**. Bancos concretos, después y con ejemplos. |
| D3 | Verificación del dominio para que la app se vea sin barra del navegador | Crear el repo `Frantejeda1993.github.io` (gratis) con un único fichero `/.well-known/assetlinks.json`. Sin él funciona igual, pero con una barra de dirección arriba. |
| D4 | Firma y compilación del APK | **GitHub Actions** compila y firma; la clave de firma la generas tú y va solo en los *secrets* del repo (nunca en el repo). Si se pierde la clave, los amigos tendrían que desinstalar y reinstalar. |
| D5 | Distribución | APK en *Releases* de GitHub, enlazado desde Ajustes. |

## 6. Lo que necesito para empezar

- Tus respuestas a D1–D5.
- **Dos o tres capturas de notificaciones de pago de Google Wallet** de tus amigos (pueden
  tapar el importe y el comercio: lo que importa es el formato y el idioma del móvil).
- Saber la versión de Android más antigua entre ellos (para fijar la mínima soportada).

## 7. Riesgos

- **Fabricantes que cierran apps en segundo plano** (Xiaomi, Huawei, algunos Samsung): pueden
  matar el lector de notificaciones. Se documenta cómo excluir la app del ahorro de batería.
- **Cambios de formato** de Wallet: el lector falla en silencio (no apunta nada). Se añadirá un
  registro local de «notificaciones no entendidas» para detectarlo.
- **Instalar APK fuera de Play** genera avisos de seguridad de Android; es normal pero hay que
  explicarlo a los amigos.
