import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  signOut as fbSignOut, type User,
} from "firebase/auth";
import { onSnapshot } from "firebase/firestore";
import { auth } from "./firebase";
import { userDoc } from "./lib/paths";
import type { Settings } from "@salary/engine";

export interface Profile {
  displayName?: string;
  onboardingDone?: boolean;
  settings: Settings & { timezone?: string; currency?: string; locale?: string; features?: Record<string, boolean> };
}

/** loading | signedOut | denied (email no invitado) | needsOnboarding | ready */
export type AuthStatus = "loading" | "signedOut" | "denied" | "needsOnboarding" | "ready";

interface AuthValue { user: User | null; profile: Profile | null; status: AuthStatus; error: string; signIn: () => Promise<void>; signOut: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    getRedirectResult(auth).catch((e) => setError(readableAuthError(e)));
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) { setProfile(null); setStatus("signedOut"); } else setStatus("loading");
    });
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      userDoc(user.uid),
      (snap) => {
        if (snap.exists() && (snap.data() as Profile).onboardingDone) {
          setProfile(snap.data() as Profile);
          setStatus("ready");
        } else if (!snap.metadata.fromCache) {
          setProfile(null);
          setStatus("needsOnboarding");
        }
      },
      (e) => {
        // Las reglas cierran todo salvo users/{uid} a emails invitados: un permiso denegado = no invitado.
        if ((e as { code?: string }).code === "permission-denied") setStatus("denied");
        else setError(e.message);
      },
    );
  }, [user]);

  async function signIn() {
    setError("");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      // En la PWA instalada (sobre todo iPhone) la ventana emergente puede estar bloqueada.
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError(readableAuthError(e));
      }
    }
  }

  const signOut = () => fbSignOut(auth);
  return <AuthContext.Provider value={{ user, profile, status, error, signIn, signOut }}>{children}</AuthContext.Provider>;
}

function readableAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "auth/unauthorized-domain") return "Este dominio no está autorizado en Firebase (Authentication → Dominios autorizados).";
  if (code === "auth/network-request-failed") return "Sin conexión. Inténtalo con señal.";
  return (e as Error)?.message || "No se pudo iniciar sesión.";
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth fuera de AuthProvider");
  return v;
}
