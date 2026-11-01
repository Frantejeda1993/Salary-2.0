/**
 * Acceso por invitación (1-nov-2026). Lógica pura: validar y normalizar emails, saber quién
 * administra y redactar la invitación. Las reglas de Firestore son las que de verdad mandan.
 */
export const ADMIN_EMAIL = "frantejeda1993@gmail.com";

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Email con forma válida (cualquier cuenta de Google, no solo @gmail.com). */
export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(e));
}

/** El administrador aprueba solicitudes. En modo prueba lo es el usuario de prueba. */
export function isAdminEmail(email: string | null | undefined, mock = false): boolean {
  if (!email) return false;
  const e = normalizeEmail(email);
  return e === ADMIN_EMAIL || (mock && e === "demo@example.com");
}

export interface AccessRequest {
  email: string; status: "pending" | "approved" | "rejected";
  requestedByUid: string; requestedByEmail: string; requestedByName: string; createdAt: string; note?: string;
}

/** Texto para compartir por WhatsApp, email…: qué es, dónde entrar y si falta la aprobación. */
export function inviteMessage(appUrl: string, inviter: string, approved: boolean): string {
  return [
    `Hola, soy ${inviter}. Te invito a Salary, la app con la que llevo mis cuentas del mes.`,
    `Entra con tu cuenta de Google aquí: ${appUrl}`,
    approved
      ? "Ya tienes acceso: al entrar te guía para configurar tus cuentas."
      : "He pedido tu acceso; en cuanto se apruebe podrás entrar con ese mismo email.",
  ].join("\n\n");
}

/** Quién pidió el acceso, en texto: «Te invita Ana» o «Lo pidió él mismo». */
export function requestOrigin(r: AccessRequest): string {
  return r.requestedByEmail && normalizeEmail(r.requestedByEmail) !== r.email
    ? `Lo invita ${r.requestedByName || r.requestedByEmail}`
    : "Lo pidió desde la app";
}
