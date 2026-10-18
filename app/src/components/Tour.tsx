/**
 * Tour de bienvenida: siete pasos sobre la pantalla real (no capturas). Se muestra una vez
 * tras la bienvenida; se puede repetir desde Ajustes. Se marca como visto en el perfil
 * (tourDone), así no reaparece en otro dispositivo.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setDoc } from "firebase/firestore";
import { userDoc } from "../lib/paths";

export interface TourStep { target: string; title: string; text: string }

export const TOUR_STEPS: TourStep[] = [
  { target: ".closing", title: "Tu mes de un vistazo",
    text: "Lo grande es lo que tienes hoy en la cuenta principal. La barra separa lo que quedará libre al cierre (verde) de lo que ya está comprometido (gris)." },
  { target: ".figures", title: "Las cifras que mandan",
    text: "Cómo cerrarías si se saldaran los préstamos, lo que arrastras del mes anterior y lo que falta por pagar. Con las flechas de arriba ves meses pasados y la previsión de los siguientes." },
  { target: ".fold-main", title: "Lo que toca pagar",
    text: "Gastos fijos, tarjetas y reembolsos del mes. Márcalos al pagarlos y el previsto se ajusta solo. Si pagaste otro importe, toca el nombre." },
  { target: ".tabbar .add", title: "Apuntar un gasto",
    text: "El botón + abre el alta rápida: importe, comercio y guardar. Recuerda tus comercios y su categoría, y avisa si parece un duplicado." },
  { target: ".tabbar .t-movimientos", title: "Movimientos",
    text: "Todo lo apuntado, por días. Busca por concepto, filtra por categoría, cuenta o fechas, y toca uno para corregirlo o borrarlo." },
  { target: ".tabbar .t-plan", title: "Plan",
    text: "Nómina, gastos fijos y budgets. Cada cambio vale desde el mes que elijas: los meses anteriores no se tocan." },
  { target: ".tabbar .t-ajustes", title: "Ajustes",
    text: "Cuentas, tarjetas de crédito y categorías. Ahí también está la guía para que el iPhone abra el gasto ya rellenado al pagar con Apple Pay." },
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;

export default function Tour({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Si un paso no tiene su elemento en pantalla (p. ej. sin pagos este mes), se salta.
  const steps = TOUR_STEPS;
  const step = steps[i];

  const finish = useCallback(() => {
    setDoc(userDoc(uid), { tourDone: true }, { merge: true }).catch(() => undefined);
    onClose();
  }, [uid, onClose]);

  const measure = useCallback(() => {
    const el = document.querySelector(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step.target]);

  useLayoutEffect(() => {
    let tries = 0;
    let timer = 0;
    const find = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        timer = window.setTimeout(measure, reduce ? 0 : 350);
      } else if (tries++ < 20) timer = window.setTimeout(find, 150);
      else if (i < steps.length - 1) setI(i + 1);
      else finish();
    };
    find();
    return () => window.clearTimeout(timer);
  }, [i, step.target, measure, steps.length, finish]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [measure]);

  useEffect(() => { nextRef.current?.focus(); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, steps.length]);

  const last = i === steps.length - 1;
  const vh = window.innerHeight;
  // La tarjeta va donde haya más sitio: debajo del elemento o encima.
  const below = !rect || rect.top + rect.height / 2 < vh / 2;
  const cardStyle = rect
    ? below ? { top: Math.min(rect.top + rect.height + 12, vh - 220) } : { bottom: Math.max(vh - rect.top + 12, 12) }
    : { top: vh / 3 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-catch" onClick={(e) => e.stopPropagation()} />
      {rect && <div className="tour-spot" style={rect} aria-hidden="true" />}
      <section className="tour-card" style={cardStyle} aria-live="polite">
        <p className="tour-count">{i + 1} de {steps.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button className="link" onClick={finish}>{last ? "Cerrar" : "Saltar"}</button>
          <span>
            {i > 0 && <button className="btn small" onClick={() => setI(i - 1)}>Atrás</button>}
            <button ref={nextRef} className="btn small primary" onClick={() => (last ? finish() : setI(i + 1))}>{last ? "Empezar" : "Siguiente"}</button>
          </span>
        </div>
      </section>
    </div>
  );
}
