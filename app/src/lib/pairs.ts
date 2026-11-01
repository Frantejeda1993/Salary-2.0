/**
 * Cuentas compartidas (fase 8b): parejas de 2 que consienten. Lógica pura sobre los
 * documentos pairs/{id}; Firestore y las reglas en pairsData.ts y firestore.rules.
 */
export type PairStatus = "pending" | "active" | "declined" | "cancelled" | "ended";
export interface Pair {
  id: string; members: string[]; status: PairStatus; invitedBy: string; invitedEmail: string;
  names: Record<string, string>; emails: Record<string, string>;
  createdAt?: string; acceptedAt?: string; endedAt?: string; endedBy?: string;
}

export interface PairState {
  /** La pareja activa (como mucho una). */
  active: Pair | null;
  /** Invitación que he enviado y aún no han contestado. */
  outgoing: Pair | null;
  /** Invitaciones que me han hecho a mí, pendientes. */
  incoming: Pair[];
}

const byDate = (a: Pair, b: Pair) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));

export function pairState(mine: Pair[], toMe: Pair[], uid: string): PairState {
  const active = mine.filter((p) => p.status === "active").sort(byDate)[0] ?? null;
  const outgoing = mine.filter((p) => p.status === "pending" && p.invitedBy === uid).sort(byDate)[0] ?? null;
  const incoming = toMe.filter((p) => p.status === "pending" && p.invitedBy !== uid).sort(byDate);
  return { active, outgoing, incoming };
}

/** La otra persona de la pareja: su uid (si ya aceptó), nombre y email. */
export function partnerOf(p: Pair, uid: string): { uid: string | null; name: string; email: string } {
  const other = p.members.find((m) => m !== uid) ?? null;
  if (other) return { uid: other, name: p.names[other] || p.emails[other] || "tu pareja", email: p.emails[other] ?? "" };
  if (p.invitedBy === uid) return { uid: null, name: p.invitedEmail, email: p.invitedEmail };
  return { uid: p.invitedBy, name: p.names[p.invitedBy] || p.emails[p.invitedBy] || "Alguien", email: p.emails[p.invitedBy] ?? "" };
}

/** Por qué no se puede invitar ahora (o null si se puede). */
export function cannotInvite(state: PairState, email: string, myEmail: string): string | null {
  if (state.active) return "Ya compartes gastos con otra persona. Deja de compartir antes de invitar a otra.";
  if (state.outgoing) return "Ya tienes una invitación pendiente. Cancélala para invitar a otra persona.";
  if (email.trim().toLowerCase() === myEmail.trim().toLowerCase()) return "No puedes invitarte a ti mismo.";
  return null;
}

export function pairInviteMessage(appUrl: string, inviter: string): string {
  return [
    `Hola, soy ${inviter}. Te invito a compartir gastos conmigo en Salary.`,
    `Entra con tu cuenta de Google aquí: ${appUrl}`,
    "Al entrar verás la invitación en Ajustes (o arriba en Mes) para aceptarla. Si es tu primera vez, primero tendrás que esperar a que se apruebe tu acceso.",
  ].join("\n\n");
}
