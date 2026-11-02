/**
 * Content-Security-Policy de la app publicada (GitHub Pages no deja poner cabeceras: va en un
 * <meta>). Solo en el build: el servidor de desarrollo de Vite usa scripts en línea.
 *
 * Lo externo que necesita la app (sacado del bundle de producción):
 *   - Firestore y Auth: firestore / identitytoolkit / securetoken .googleapis.com
 *   - Login con Google: script https://apis.google.com y el iframe de <proyecto>.firebaseapp.com
 * Si un día se añade otro servicio, hay que añadir su dominio aquí o el navegador lo bloqueará.
 */
import type { Plugin } from "vite";

export const AUTH_DOMAIN = "salary2-ee33e.firebaseapp.com";

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://www.gstatic.com",
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com",
  `frame-src https://${AUTH_DOMAIN} https://accounts.google.com https://apis.google.com`,
  "img-src 'self' data: https://www.google.com https://*.googleusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

export function cspPlugin(): Plugin {
  return {
    name: "salary-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace(`<meta charset="UTF-8" />`, `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
  };
}
