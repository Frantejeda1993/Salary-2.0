import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./Icons";

/** Hoja inferior modal. Se cierra con el fondo, la X o Escape. */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    // Al cerrar, el foco vuelve a donde estaba (el botón que abrió la hoja).
    const opener = document.activeElement as HTMLElement | null;
    // Mientras la hoja está abierta, lo de detrás no se alcanza con el teclado ni con VoiceOver.
    // Si nada dentro tomó el foco (autoFocus), se lleva a la hoja para que el lector la anuncie.
    const behind = [...document.querySelectorAll<HTMLElement>(".content, .tabbar")];
    behind.forEach((e) => e.setAttribute("inert", ""));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => { if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true }); }, 0);
    return () => {
      window.clearTimeout(t);
      behind.forEach((e) => e.removeAttribute("inert"));
      document.body.style.overflow = prev;
      if (opener && opener !== document.body && !opener.classList.contains("focus-proxy") && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  // La hoja se pinta fuera de la pantalla (.content), que queda inerte mientras está abierta.
  // Si se pintara dentro, la hoja heredaría el «inert» y no respondería.
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <section ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="grip" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><IconClose /></button>
        </header>
        {children}
      </section>
    </>,
    document.querySelector(".app") ?? document.body,
  );
}
