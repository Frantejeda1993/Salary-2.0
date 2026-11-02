/**
 * Guía de Android (fase 8d): descargar el APK, instalarlo, dar los permisos y usarlo.
 * La app de Android es esta misma web dentro de Chrome más un lector de las notificaciones de pago.
 */
import { useState } from "react";
import { APK_URL, AVISOS_INTENT, type Platform } from "../lib/platform";

export default function AndroidGuide({ platform }: { platform: Platform }) {
  const inApp = platform === "android-app";
  const [copied, setCopied] = useState(false);
  return (
    <div className="guide">
      <p>Al pagar con Google Wallet (móvil o reloj), Salary te avisa: «12,50 € en Mercadona · toca para apuntarlo». Al tocar el aviso se abre el gasto con el importe, el comercio y la tarjeta ya puestos. Tú eliges la categoría y guardas.</p>
      <ul className="guide-limits">
        <li>Funciona con los pagos que avisa Google Wallet. Si tu banco también te avisa de cada pago, puedes activarlo en «Avisos de pago».</li>
        <li>Nada se guarda solo: siempre confirmas tú.</li>
        <li>Necesita la app de Android: en el navegador no puede leer notificaciones.</li>
      </ul>

      {inApp ? (
        <>
          <h4 className="guide-h">Ya tienes la app instalada</h4>
          <a className="btn primary wide" href={AVISOS_INTENT}>Configurar avisos de pago</a>
        </>
      ) : (
        <>
          <h4 className="guide-h">1. Descarga la app</h4>
          {platform === "android-web"
            ? <a className="btn primary wide" href={APK_URL}>Descargar Salary para Android (APK)</a>
            : <>
                <p className="muted small">Hazlo desde el móvil Android: abre Salary en Chrome, ve a Ajustes → «Apuntar pagos automáticamente» → Android, o abre este enlace en el móvil:</p>
                <span className="guide-code"><code>{APK_URL}</code>
                  <button className="btn small" onClick={() => navigator.clipboard?.writeText(APK_URL).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => undefined)}>{copied ? "Copiado" : "Copiar"}</button></span>
              </>}
          <h4 className="guide-h">2. Instálala</h4>
          <ol className="guide-steps">
            <li>Abre el archivo <b>salary.apk</b> desde la notificación de descarga (o desde «Descargas»).</li>
            <li>Android avisará de que no puede instalar apps de esta fuente: toca <b>Ajustes</b>, activa <b>Permitir de esta fuente</b> para Chrome y vuelve.</li>
            <li>Toca <b>Instalar</b>. Si Play Protect avisa de que la app es desconocida, toca <b>Más detalles → Instalar de todas formas</b>: es normal, no está en Google Play.</li>
          </ol>
          <h4 className="guide-h">3. Ábrela y entra</h4>
          <p>Abre <b>Salary</b> desde el icono y entra con la misma cuenta de Google que usas aquí. Tus datos ya están: no se pierde nada.</p>
        </>
      )}

      <h4 className="guide-h">{inApp ? "Configúrala una vez" : "4. Activa los avisos de pago"}</h4>
      <ol className="guide-steps">
        <li>En la app: Ajustes → «Apuntar pagos automáticamente» → <b>Configurar avisos de pago</b> (o mantén pulsado el icono de Salary → <b>Avisos de pago</b>).</li>
        <li><b>Permiso para leer notificaciones</b>: toca «Activar en Ajustes de Android», busca Salary y actívalo. Android te avisará de que podrá leer notificaciones: Salary solo mira las de las apps que elijas.</li>
        <li>Si sale <b>«Ajuste restringido»</b> (Android 13 o posterior, por no venir de Google Play): ve a Ajustes de Android → Aplicaciones → Salary → menú <b>⋮</b> arriba a la derecha → <b>Permitir ajustes restringidos</b>, y repite el paso anterior.</li>
        <li><b>Permiso para avisarte</b>: tócalo y acepta.</li>
        <li>Comprueba que <b>Google Wallet</b> está activado y pulsa <b>Enviar un aviso de prueba</b>: toca el aviso y debe abrirse un gasto de 1,00 € (no lo guardes).</li>
        <li>En Xiaomi, Huawei, Oppo o algunos Samsung: <b>Ajustes de batería</b> → quita a Salary de la optimización. Si no, el móvil puede cerrarla y dejarán de llegar avisos.</li>
      </ol>

      <h4 className="guide-h">Al pagar</h4>
      <ol className="guide-steps">
        <li>Paga con Google Wallet como siempre. Llega el aviso de Salary.</li>
        <li>Tócalo: se abre el gasto rellenado. Elige la categoría y guarda.</li>
        <li>La primera vez con cada tarjeta, la app te pregunta con qué pagaste y lo recuerda para las siguientes.</li>
      </ol>

      <details className="secondary">
        <summary>Si no llega el aviso</summary>
        <ul className="guide-limits">
          <li>Abre «Avisos de pago» y mira <b>Últimas notificaciones de pago vistas</b>: si tu pago aparece como «No entendido», toca <b>Copiar para enviárselas a Francisco</b> y mándaselo. Se queda solo en tu móvil hasta que tú lo copies.</li>
          <li>Si no aparece nada, revisa que el permiso de notificaciones siga activado y la batería sin optimizar.</li>
          <li>Para actualizar la app, descarga de nuevo el APK e instálalo encima: no se borra nada.</li>
        </ul>
      </details>
    </div>
  );
}
