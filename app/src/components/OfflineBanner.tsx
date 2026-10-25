/**
 * Aviso de «sin conexión». Lo que apuntas se guarda en este dispositivo y se envía al volver
 * la señal. Ojo: Safari y la app de la pantalla de inicio guardan por separado, así que lo
 * apuntado desde el atajo sin conexión se envía cuando vuelvas a abrir Safari con señal.
 */
import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (online) return null;
  return (
    <div className="offline" role="status">
      <span>Sin conexión. Lo que apuntes se guarda aquí y se enviará al volver la señal; no borres los datos del navegador hasta entonces.</span>
    </div>
  );
}
