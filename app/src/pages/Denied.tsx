/**
 * Sin acceso: la cuenta de Google no está en la lista de invitados. Desde aquí se pide
 * acceso; el administrador lo aprueba en sus Ajustes. No llega aviso al aprobarse: se
 * comprueba con «Comprobar de nuevo».
 */
import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import type { AccessRequest } from "../lib/access";
import { myRequest, requestAccess } from "../lib/accessData";

export default function Denied() {
  const { user, signOut } = useAuth();
  const [req, setReq] = useState<AccessRequest | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const email = user?.email ?? "";

  useEffect(() => { if (email) myRequest(email).then(setReq); }, [email]);

  async function ask() {
    if (!user) return;
    setSending(true);
    await requestAccess({ uid: user.uid, email, name: user.displayName ?? email }, email);
    setReq(await myRequest(email));
    setSending(false);
  }

  return (
    <div className="center-screen denied">
      <h1 className="title-lg">Sin acceso todavía</h1>
      <p className="muted">Salary funciona por invitación. La cuenta <strong>{email}</strong> aún no tiene acceso.</p>

      {req === undefined ? <p className="muted small">Comprobando…</p>
        : req?.status === "pending" ? (
          <section className="card status-card" role="status">
            <p><strong>Solicitud enviada.</strong> {req.requestedByEmail && req.requestedByEmail !== email
              ? `${req.requestedByName || req.requestedByEmail} ya pidió tu acceso.` : "La has pedido tú."}
              {" "}En cuanto se apruebe podrás entrar; no llega aviso, vuelve a comprobarlo más tarde.</p>
            <button className="btn primary wide" onClick={() => window.location.reload()}>Comprobar de nuevo</button>
          </section>
        ) : req?.status === "rejected" ? (
          <p className="warn">La solicitud de acceso para esta cuenta no se aprobó. Si crees que es un error, habla con quien te invitó.</p>
        ) : req?.status === "approved" ? (
          <section className="card status-card" role="status">
            <p><strong>Acceso aprobado.</strong> Entra de nuevo para empezar.</p>
            <button className="btn primary wide" onClick={() => window.location.reload()}>Entrar</button>
          </section>
        ) : (
          <button className="btn primary wide" onClick={ask} disabled={sending}>{sending ? "Enviando…" : "Pedir acceso"}</button>
        )}

      <button className="btn wide ghost" onClick={signOut}>Usar otra cuenta de Google</button>
    </div>
  );
}
