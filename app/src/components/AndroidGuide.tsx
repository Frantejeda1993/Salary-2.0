/** Ajustes → Android: instalar la app y configurar los avisos de pago (fase 8d). */
import { APK_URL, AVISOS_INTENT, type Platform } from "../lib/platform";

export default function AndroidGuide({ platform }: { platform: Platform }) {
  if (platform === "android-app") {
    return (
      <>
        <p className="muted small">Cuando pagas con Google Wallet, Salary te avisa y al tocar el aviso se abre el gasto rellenado para confirmarlo. Nada se guarda sin que lo confirmes.</p>
        <a className="btn primary wide" href={AVISOS_INTENT}>Configurar avisos de pago</a>
        <p className="muted small">Ahí das el permiso para leer notificaciones, eliges de qué apps (por defecto, solo Google Wallet) y puedes enviar un aviso de prueba.</p>
      </>
    );
  }
  return (
    <>
      <p className="muted small">La app de Android es esta misma app, más un lector de las notificaciones de pago de Google Wallet: al pagar te avisa y con un toque apuntas el gasto.</p>
      {platform === "android-web" ? <>
        <a className="btn primary wide" href={APK_URL}>Descargar la app (APK)</a>
        <ol className="install-steps small">
          <li>Abre el archivo descargado. Android te pedirá permitir instalar apps de esta fuente: acéptalo solo para tu navegador.</li>
          <li>Si Play Protect avisa de que la app es desconocida, elige «Instalar de todas formas»: no está en Google Play.</li>
          <li>Abre Salary, entra con tu cuenta de Google y ve a Ajustes → Android → «Configurar avisos de pago».</li>
        </ol>
      </> : <p className="muted small">Ábrelo desde el móvil Android para descargarla: <span className="mono">{APK_URL}</span></p>}
    </>
  );
}
