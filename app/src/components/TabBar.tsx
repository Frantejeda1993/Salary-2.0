import { NavLink } from "react-router-dom";
import { IconList, IconMonth, IconPlan, IconPlus, IconSettings } from "./Icons";

/** Cuatro secciones y, en el centro, el alta rápida (a mano del pulgar y sin tapar contenido). */
export default function TabBar({ onAdd, settingsBadge = 0 }: { onAdd: () => void; settingsBadge?: number }) {
  return (
    <nav className="tabbar" aria-label="Secciones">
      <NavLink to="/" end className="t-mes"><IconMonth />Mes</NavLink>
      <NavLink to="/movimientos" className="t-movimientos"><IconList />Movimientos</NavLink>
      <button className="add" onClick={onAdd} aria-label="Añadir movimiento"><span><IconPlus /></span></button>
      <NavLink to="/plan" className="t-plan"><IconPlan />Plan</NavLink>
      <NavLink to="/ajustes" className="t-ajustes" aria-label={settingsBadge ? `Ajustes, ${settingsBadge} solicitudes de acceso pendientes` : undefined}>
        <IconSettings />Ajustes{settingsBadge > 0 && <span className="tab-badge" aria-hidden="true">{settingsBadge}</span>}</NavLink>
    </nav>
  );
}
