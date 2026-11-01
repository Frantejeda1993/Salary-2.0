/** Sección desplegable con su total a la derecha: se ve todo de un vistazo y se abre lo que interesa. */
import { useEffect, useRef, type ReactNode } from "react";

/**
 * `open` abre la sección cuando pasa a verdadero (p. ej. hay algo pendiente), pero nunca la
 * cierra sola: si lo pendiente desaparece mientras la usas, sigue abierta.
 */
export default function Fold({ title, total, sub, children, open, className = "" }: {
  title: string; total?: ReactNode; sub?: ReactNode; children: ReactNode; open?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (open && ref.current) ref.current.open = true; }, [open]);
  return (
    <details ref={ref} className={`fold ${className}`}>
      <summary>
        <span className="fold-title">{title}</span>
        {(total !== undefined || sub) && <span className="fold-total">{total}{sub && <small>{sub}</small>}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
