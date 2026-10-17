import { NavLink } from "react-router-dom";

export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="Secciones">
      <NavLink to="/" end>Inicio</NavLink>
      <NavLink to="/ajustes">Ajustes</NavLink>
    </nav>
  );
}
