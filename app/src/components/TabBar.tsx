import { NavLink } from "react-router-dom";
import { IconList, IconMonth, IconPlan, IconPlus, IconSettings } from "./Icons";

/** Cuatro secciones y, en el centro, el alta rápida (a mano del pulgar y sin tapar contenido). */
export default function TabBar({ onAdd }: { onAdd: () => void }) {
  return (
    <nav className="tabbar" aria-label="Secciones">
      <NavLink to="/" end><IconMonth />Mes</NavLink>
      <NavLink to="/movimientos"><IconList />Movimientos</NavLink>
      <button className="add" onClick={onAdd} aria-label="Añadir movimiento"><span><IconPlus /></span></button>
      <NavLink to="/plan"><IconPlan />Plan</NavLink>
      <NavLink to="/ajustes"><IconSettings />Ajustes</NavLink>
    </nav>
  );
}
