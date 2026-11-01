/**
 * Compartir gastos (fase 8b): invitar a tu pareja, aceptar o rechazar una invitación y dejar
 * de compartir. El estado vive en un contexto para que Mes y Ajustes lo lean sin duplicar
 * escuchas a Firestore.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { normalizeEmail, validEmail } from "../lib/access";
import { grantAccess, requestAccess, type Me } from "../lib/accessData";
import { cannotInvite, pairInviteMessage, partnerOf, type Pair, type PairState } from "../lib/pairs";
import { acceptPair, cancelPair, declinePair, endPair, invitePartner, usePairs } from "../lib/pairsData";
import { useUI } from "../ui";
import { useIsAdmin } from "./AccessSettings";
import Fold from "./Fold";
import { appBase } from "./ShortcutGuide";

type Ctx = PairState & { ready: boolean };
const PairsContext = createContext<Ctx>({ active: null, outgoing: null, incoming: [], ready: false });

export function PairsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const state = usePairs(user?.uid, user?.email ?? undefined);
  return <PairsContext.Provider value={state}>{children}</PairsContext.Provider>;
}
export const usePairState = () => useContext(PairsContext);

const dayText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");

function useMe(): Me | null {
  const { user } = useAuth();
  return user ? { uid: user.uid, email: user.email ?? "", name: user.displayName ?? user.email ?? "" } : null;
}

async function shareText(text: string): Promise<boolean> {
  try { if (navigator.share) { await navigator.share({ title: "Compartir gastos en Salary", text }); return true; } } catch { return false; }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Qué ve cada uno al aceptar: lo que se comparte y lo que no. */
const CONSENT = "Si aceptas, los dos veréis los gastos que marquéis como compartidos, lo que os debéis y, para repartir por ingresos, el total que cobra cada uno al mes. Nada más de vuestras cuentas.";

function IncomingCard({ p }: { p: Pair }) {
  const me = useMe();
  const { toast } = useUI();
  const { active } = usePairState();
  const who = me ? partnerOf(p, me.uid) : null;
  const [busy, setBusy] = useState(false);
  if (!me || !who) return null;
  return (
    <section className="card pair-card" aria-label="Invitación para compartir gastos">
      <p><strong>{who.name}</strong>{who.email && who.email !== who.name ? ` (${who.email})` : ""} te invita a compartir gastos.</p>
      <p className="muted small">{CONSENT}</p>
      {active && <p className="warn">Ya compartes gastos con {partnerOf(active, me.uid).name}. Deja de compartir antes de aceptar otra invitación.</p>}
      <div className="pair-actions">
        <button className="btn primary" disabled={busy || !!active} onClick={async () => {
          setBusy(true);
          try { await acceptPair(me, p); toast(`Ya compartes gastos con ${who.name}`); } catch { toast("No se pudo aceptar: inténtalo de nuevo"); }
          setBusy(false);
        }}>Aceptar</button>
        <button className="btn" disabled={busy} onClick={() => declinePair(p).then(() => toast("Invitación rechazada"))}>Rechazar</button>
      </div>
    </section>
  );
}

export default function PairSettings() {
  const me = useMe();
  const admin = useIsAdmin();
  const { toast } = useUI();
  const state = usePairState();
  const { active, outgoing, incoming, ready } = state;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!me) return null;
  const why = validEmail(email) ? cannotInvite(state, email, me.email) : null;

  async function invite() {
    if (!me || !validEmail(email) || why) return;
    setBusy(true);
    const e = normalizeEmail(email);
    try {
      await invitePartner(me, e);
      // Si aún no es usuario, su acceso queda pedido (o dado, si invita el administrador).
      if (admin) await grantAccess(me, e).catch(() => undefined); else await requestAccess(me, e);
      const ok = await shareText(pairInviteMessage(appBase(), me.name.split(" ")[0] || me.name));
      toast(ok ? "Invitación enviada" : "Invitación creada: avísale de que entre en la app");
      setEmail("");
    } catch {
      toast("No se pudo crear la invitación: inténtalo de nuevo");
    }
    setBusy(false);
  }

  const summary = active ? `Con ${partnerOf(active, me.uid).name}` : outgoing ? "Invitación pendiente" : incoming.length ? "Te han invitado" : "Con tu pareja";
  return (
    <Fold title="Compartir gastos" sub={summary} open={incoming.length > 0}>
      {!ready && <p className="muted small">Cargando…</p>}
      {incoming.map((p) => <IncomingCard key={p.id} p={p} />)}

      {active ? (
        <section className="pair-active">
          <p>Compartes gastos con <strong>{partnerOf(active, me.uid).name}</strong>
            {partnerOf(active, me.uid).email ? ` (${partnerOf(active, me.uid).email})` : ""} desde el {dayText(active.acceptedAt)}.</p>
          <p className="muted small">Pronto podrás marcar un gasto como compartido al apuntarlo y repartirlo por porcentaje o por ingresos.</p>
          {!confirmEnd
            ? <button className="link danger" onClick={() => setConfirmEnd(true)}>Dejar de compartir</button>
            : <div className="pair-actions">
                <p className="warn">Dejaréis de ver los gastos compartidos del otro. Tus cuentas no cambian.</p>
                <button className="btn danger-btn" onClick={() => endPair(active, me.uid).then(() => { toast("Ya no compartes gastos"); setConfirmEnd(false); })}>Sí, dejar de compartir</button>
                <button className="btn" onClick={() => setConfirmEnd(false)}>Cancelar</button>
              </div>}
        </section>
      ) : outgoing ? (
        <section className="pair-active">
          <p>Invitaste a <strong>{outgoing.invitedEmail}</strong> el {dayText(outgoing.createdAt)}. Cuando entre en la app verá la invitación para aceptarla.</p>
          {!admin && <p className="muted small">Si aún no usa Salary, primero tendrá que aprobarse su acceso.</p>}
          <div className="pair-actions">
            <button className="btn" onClick={() => shareText(pairInviteMessage(appBase(), me.name.split(" ")[0] || me.name)).then((ok) => ok && toast("Invitación compartida"))}>Enviar de nuevo</button>
            <button className="link danger" onClick={() => cancelPair(outgoing).then(() => toast("Invitación cancelada"))}>Cancelar invitación</button>
          </div>
        </section>
      ) : incoming.length ? null : (
        <>
          <p className="muted small">Pensado para parejas: invitas a una persona y, cuando acepte, podréis marcar gastos como compartidos y repartirlos. Hacen falta los dos consentimientos.</p>
          <label className="field"><span>Email de su cuenta de Google</span>
            <input className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" placeholder="nombre@gmail.com"
                   value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!email && !validEmail(email)} /></label>
          {email && !validEmail(email) && <p className="field-error">Ese email no parece completo.</p>}
          {why && <p className="field-error">{why}</p>}
          <button className="btn primary wide" disabled={!validEmail(email) || !!why || busy} onClick={invite}>{busy ? "Enviando…" : "Invitar a compartir gastos"}</button>
        </>
      )}
    </Fold>
  );
}

/** Aviso arriba en Mes cuando alguien te invita. */
export function PairInviteBanner() {
  const { incoming } = usePairState();
  const me = useMe();
  const navigate = useNavigate();
  if (!incoming.length || !me) return null;
  const who = partnerOf(incoming[0], me.uid);
  return (
    <button className="pair-banner" onClick={() => navigate("/ajustes")}>
      <span><strong>{who.name}</strong> te invita a compartir gastos.</span><span className="pair-banner-cta">Ver</span>
    </button>
  );
}
