/** Sección desplegable con su total a la derecha: se ve todo de un vistazo y se abre lo que interesa. */
import type { ReactNode } from "react";

export default function Fold({ title, total, sub, children, open, className = "" }: {
  title: string; total?: ReactNode; sub?: ReactNode; children: ReactNode; open?: boolean; className?: string;
}) {
  return (
    <details className={`fold ${className}`} open={open}>
      <summary>
        <span className="fold-title">{title}</span>
        {(total !== undefined || sub) && <span className="fold-total">{total}{sub && <small>{sub}</small>}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
