import type { ReactNode } from "react";
import { IconList, IconMonth, IconPlan, IconSettings } from "./Icons";

export type ScreenId = "mes" | "movimientos" | "plan" | "ajustes";
const META: Record<ScreenId, { title: string; icon: () => ReactNode }> = {
  mes: { title: "Mes", icon: IconMonth },
  movimientos: { title: "Movimientos", icon: IconList },
  plan: { title: "Plan", icon: IconPlan },
  ajustes: { title: "Ajustes", icon: IconSettings },
};

/** Cabecera de cada pantalla: su icono y su nombre en el color propio de la pantalla. */
export default function ScreenHeader({ id, children }: { id: ScreenId; children?: ReactNode }) {
  const { title, icon: Icon } = META[id];
  return (
    <header className="screen-head">
      <span className="screen-chip" aria-hidden="true"><Icon /></span>
      <h1>{title}</h1>
      {children && <div className="screen-head-extra">{children}</div>}
    </header>
  );
}
