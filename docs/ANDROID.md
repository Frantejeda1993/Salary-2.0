# Salary para Android (fase 8d)

La app de Android es **la misma PWA** dentro de una Trusted Web Activity (Chrome por debajo:
login de Google, caché offline y actualizaciones de la web) más un **lector de notificaciones de
pago**. Al pagar con Google Wallet llega «12,50 € en Mercadona · toca para apuntarlo»; al tocar se
abre el alta rápida rellena (`#/nuevo?importe=…&comercio=…&wallet=…&fecha=…`, lo mismo que el atajo
de iPhone). Nada se guarda sin confirmarlo en la app.

| Pieza | Dónde |
| --- | --- |
| Lector de importe, comercio y tarjeta (Java puro, con tests) | `android/app/src/main/java/es/frantejeda/salary/PaymentParser.java` |
| Servicio que lee notificaciones y avisa | `PaymentListener.java` |
| Pantalla «Avisos de pago» (permisos, apps, prueba, diagnóstico) | `SettingsActivity.java` (`salary://avisos`) |
| Compilación, firma y publicación | `.github/workflows/android.yml` → Releases, `salary.apk` |
| Enlace de descarga y botón de avisos en la PWA | Ajustes → Android (`app/src/components/AndroidGuide.tsx`) |

Descarga (siempre la última): <https://github.com/Frantejeda1993/Salary-2.0/releases/latest/download/salary.apk>

## Puesta en marcha (una vez, Francisco)

1. **Secrets de firma.** La clave está en `~/.salary-keys/salary-android.jks` y los valores en
   `~/.salary-keys/salary-android-secrets.txt`. En GitHub → repo → Settings → Secrets and
   variables → Actions → *New repository secret*, crea los 4: `ANDROID_KEY_ALIAS`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEYSTORE_BASE64`.
   Guarda copia de la clave fuera del PC (si se pierde, hay que desinstalar y reinstalar).
2. **Primer APK.** GitHub → Actions → «App Android» → *Run workflow*. Al terminar, el APK está
   en Releases. A partir de ahí se publica solo en cada cambio de `android/`.
3. **(Opcional) Sin barra de navegador.** Crea el repo público `Frantejeda1993.github.io` con
   GitHub Pages activado y el fichero `.well-known/assetlinks.json` con el contenido de
   [`docs/android/assetlinks.json`](android/assetlinks.json). Sin él la app funciona igual, pero
   Chrome muestra una barra con la dirección arriba.

## Instalar (amigos)

1. Desde el móvil, abrir Salary en Chrome → Ajustes → Android → «Descargar la app (APK)».
2. Permitir instalar desde el navegador y, si Play Protect avisa, «Instalar de todas formas».
3. Abrir Salary → Ajustes → Android → «Configurar avisos de pago»: activar el acceso a
   notificaciones, el permiso de avisos y enviar un aviso de prueba.
4. Xiaomi, Huawei y algunos Samsung cierran apps en segundo plano: quitar Salary del ahorro de batería.

## Cuando algo no funcione

En «Avisos de pago» → «Últimas notificaciones de pago vistas» aparece cada notificación de las
apps activadas y cómo se ha entendido. «Copiar para enviárselas a Francisco» copia la lista: con
eso se ajusta `PaymentParser` (y se añade el caso a `PaymentParserTest`). La lista vive solo en el
móvil y solo guarda texto de las apps activadas; de las demás, solo se recuerda el nombre de la
app si mostró algo parecido a un importe, para ofrecerla.
