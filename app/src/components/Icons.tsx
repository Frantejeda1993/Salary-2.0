/** Iconos de trazo, 24×24, del color del texto. */
import type { ReactNode } from "react";
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true" {...P}>{children}</svg>;

export const IconMonth = () => svg(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IconList = () => svg(<><path d="M9 7h11M9 12h11M9 17h11" /><circle cx="4.5" cy="7" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="17" r="1" /></>);
export const IconPlan = () => svg(<><path d="M4 19V9M10 19V5M16 19v-7M21 19H3" /></>);
export const IconSettings = () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconPlus = () => svg(<path d="M12 5v14M5 12h14" />);
export const IconPrev = () => svg(<path d="M15 6l-6 6 6 6" />);
export const IconNext = () => svg(<path d="M9 6l6 6-6 6" />);
export const IconClose = () => svg(<path d="M6 6l12 12M18 6L6 18" />);
export const IconPencil = () => svg(<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />);
