/**
 * Ajustes → invitar a alguien (todos) y solicitudes de acceso (solo el administrador).
 * Sin servidor: la invitación se comparte con el menú del móvil (WhatsApp, email…) y el
 * administrador aprueba desde aquí.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { IS_MOCK } from "../firebase";
import { inviteMessage, isAdminEmail, normalizeEmail, requestOrigin, validEmail, type AccessRequest } from "../lib/access";
import { deleteRequest, grantAccess, rejectRequest, requestAccess, revokeAccess, useAllowlist, useAllRequests, useMyInvites, type Me } from "../lib/accessData";
import { useUI } from "../ui";
import Fold from "./Fold";
import { appBase } from "./ShortcutGuide";

const STATUS: Record<AccessRequest["status"], string> = { pending: "Pendiente de aprobar", approved: "Aprobada", rejected: "No aprobada" };

async function share(text: string): Promise<"shared" | "copied" | "none"> {
  try {
    if (navigator.share) { await navigator.share({ title: "Invitación a Salary", text }); return "shared"; }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "none";
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { return "none"; }
}

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return isAdminEmail(user?.email, IS_MOCK);
}

export default function AccessSettings() {
  const { user } = useAuth();
  const { toast } = useUI();
  const admin = useIsAdmin();
  const me: Me | null = user ? { uid: user.uid, email: user.email ?? "", name: user.displayName ?? user.email ?? "" } : null;
  const mine = useMyInvites(user?.uid);
  const all = useAllRequests(admin);
  const allow = useAllowlist(admin);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastText, setLastText] = useState<string | null>(null);
  const valid = validEmail(email);
  const pending = all.filter((r) => r.status === "pending");
  // Se abre sola si hay pendientes, y no se cierra sola al aprobar la última.
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => { if (pending.length) setAutoOpen(true); }, [pending.length]);

  async function invite() {
    if (!me || !valid) return;
    const e = normalizeEmail(email);
    setBusy(true);
    let approved = false;
    if (admin) { await grantAccess(me, e); approved = true; }
    else if ((await requestAccess(me, e)) === "exists") toast("Ese email ya tenía una solicitud: comparte la invitación igualmente.");
    const text = inviteMessage(appBase(), me.name.split(" ")[0] || me.name, approved);
    const how = await share(text);
    setLastText(how === "none" ? text : null);
    toast(how === "copied" ? "Invitación copiada: pégala en WhatsApp o en un email" : approved ? "Acceso dado e invitación lista" : "Solicitud enviada");
    setEmail("");
    setBusy(false);
  }

  return <>
    <Fold title="Invitar a alguien" sub={admin ? "Das acceso al momento" : "El acceso se aprueba aparte"}>
      <p className="muted small">Escribe el email de su cuenta de Google. {admin
        ? "Como administrador, el acceso queda dado al momento."
        : "Se envía una solicitud de acceso; cuando se apruebe podrá entrar."} Después eliges cómo mandarle la invitación (WhatsApp, email…).</p>
      <label className="field"><span>Email de su cuenta de Google</span>
        <input className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" placeholder="nombre@gmail.com"
               value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!email && !valid} /></label>
      {email && !valid && <p className="field-error">Ese email no parece completo.</p>}
      <button className="btn primary wide" disabled={!valid || busy} onClick={invite}>{busy ? "Enviando…" : "Invitar"}</button>
      {lastText && <div className="guide-code"><code>{lastText}</code></div>}
      {mine.length > 0 && (
        <ul className="rows invites">
          {mine.map((r) => <li key={r.id}><span className="what"><b>{r.email}</b><small>{STATUS[r.status]}</small></span></li>)}
        </ul>
      )}
    </Fold>

    {admin && (
      <Fold title="Solicitudes de acceso" total={pending.length ? <span className="badge-count">{pending.length}</span> : undefined}
            sub={pending.length ? "pendientes" : "ninguna pendiente"} open={autoOpen || undefined}>
        {pending.length === 0 && <p className="muted small">No hay solicitudes pendientes.</p>}
        {pending.length > 0 && (
          <ul className="rows">
            {pending.map((r) => (
              <li key={r.id}>
                <span className="what"><b>{r.email}</b><small>{requestOrigin(r)}</small></span>
                <span className="act">
                  <button className="btn small primary" onClick={() => me && grantAccess(me, r.email, r).then(() => toast(`${r.email} ya puede entrar`))}>Aprobar</button>
                  <button className="link danger" onClick={() => rejectRequest(r.email).then(() => toast("Solicitud rechazada"))}>Rechazar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="sub-head">Con acceso ({allow.length})</h3>
        <ul className="rows">
          {allow.length === 0 && <li className="empty">Solo tú.</li>}
          {allow.map((a) => (
            <li key={a.id}>
              <span className="what"><b>{a.id}</b>{a.invitedBy && <small>Invitado por {a.invitedBy}</small>}</span>
              <span className="act"><button className="link danger" onClick={() => revokeAccess(a.id).then(() => toast(`${a.id} ya no puede entrar`))}>Quitar acceso</button></span>
            </li>
          ))}
        </ul>
        <p className="muted small">Quitar el acceso no borra sus datos: deja de poder entrar hasta que vuelvas a aprobarlo.</p>
        {all.some((r) => r.status === "rejected") && (
          <details className="secondary">
            <summary>Rechazadas</summary>
            <ul className="rows">
              {all.filter((r) => r.status === "rejected").map((r) => (
                <li key={r.id}><span className="what"><b>{r.email}</b><small>{requestOrigin(r)}</small></span>
                  <span className="act"><button className="link" onClick={() => deleteRequest(r.email).then(() => toast("Podrá volver a pedir acceso"))}>Permitir que lo pida otra vez</button></span></li>
              ))}
            </ul>
          </details>
        )}
      </Fold>
    )}
  </>;
}

/** Número de solicitudes pendientes (para el aviso en la pestaña Ajustes del administrador). */
export function usePendingRequests(): number {
  const admin = useIsAdmin();
  return useAllRequests(admin).filter((r) => r.status === "pending").length;
}
