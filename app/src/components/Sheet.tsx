import { useEffect, type ReactNode } from "react";
import { IconClose } from "./Icons";

/** Hoja inferior modal. Se cierra con el fondo, la X o Escape. */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Al cerrar, el foco vuelve a donde estaba (el botón que abrió la hoja).
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; if (opener && !opener.classList.contains("focus-proxy")) opener.focus(); };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grip" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><IconClose /></button>
        </header>
        {children}
      </section>
    </>
  );
}
