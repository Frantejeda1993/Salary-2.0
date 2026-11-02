/**
 * En qué se está usando la app: la app de Android (TWA), Android en el navegador o otro sistema.
 * La TWA abre la web con document.referrer = «android-app://es.frantejeda.salary»; se recuerda
 * en la pestaña porque al navegar el referrer se pierde.
 */
export const ANDROID_PACKAGE = "es.frantejeda.salary";
export const APK_URL = "https://github.com/Frantejeda1993/Salary-2.0/releases/latest/download/salary.apk";
/** Abre la pantalla nativa «Avisos de pago» (intent-filter salary://avisos de la app). */
export const AVISOS_INTENT = `intent://avisos#Intent;scheme=salary;package=${ANDROID_PACKAGE};end`;

export type Platform = "android-app" | "android-web" | "other";

export function detectPlatform(userAgent: string, referrer: string, remembered: boolean): Platform {
  if (remembered || referrer.startsWith(`android-app://${ANDROID_PACKAGE}`)) return "android-app";
  return /Android/i.test(userAgent) ? "android-web" : "other";
}

const KEY = "salary-android-app";

export function currentPlatform(): Platform {
  let remembered = false;
  try { remembered = sessionStorage.getItem(KEY) === "1"; } catch { /* sin almacenamiento: no pasa nada */ }
  const p = detectPlatform(navigator.userAgent, document.referrer, remembered);
  if (p === "android-app") { try { sessionStorage.setItem(KEY, "1"); } catch { /* idem */ } }
  return p;
}
