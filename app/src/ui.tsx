/**
 * Estado de interfaz compartido: el aviso inferior (con «Deshacer») y la hoja de alta rápida.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { setWriteErrorHandler, type Undo } from "./lib/actions";

export interface QuickAddPrefill {
  amount?: string; description?: string; payWith?: string; date?: string; source?: "app" | "shortcut";
  /** Editar un movimiento existente en vez de crear uno. */
  edit?: { id: string; data: Record<string, unknown> };
  /** Avisos sobre el atajo (p. ej. una tarjeta que no se encontró). */
  notes?: string[];
  /** Nombre de la tarjeta en Wallet (atajo genérico): se ofrece recordar con qué se pagó. */
  walletName?: string;
  /** Con qué se pagó según lo aprendido (para saber si el usuario lo cambió). */
  walletMatch?: string | null;
}

interface UIValue {
  toast: (text: string, undo?: Undo) => void;
  quickAdd: QuickAddPrefill | null;
  openQuickAdd: (p?: QuickAddPrefill) => void;
  closeQuickAdd: () => void;
}
const UIContext = createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; undo?: Undo; n: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddPrefill | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((text: string, undo?: Undo) => {
    clearTimeout(timer.current);
    setMsg({ text, undo, n: Date.now() });
    timer.current = setTimeout(() => setMsg(null), undo ? 6000 : 3500);
  }, []);
  useEffect(() => { setWriteErrorHandler((m) => toast(m)); }, [toast]);

  const openQuickAdd = useCallback((p: QuickAddPrefill = {}) => { setMsg(null); setQuickAdd(p); }, []);
  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);

  return (
    <UIContext.Provider value={{ toast, quickAdd, openQuickAdd, closeQuickAdd }}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite" key={msg.n}>
          <span>{msg.text}</span>
          {msg.undo && <button onClick={() => { msg.undo!(); setMsg(null); toast("Deshecho"); }}>Deshacer</button>}
        </div>
      )}
    </UIContext.Provider>
  );
}

export function useUI(): UIValue {
  const v = useContext(UIContext);
  if (!v) throw new Error("useUI fuera de UIProvider");
  return v;
}
