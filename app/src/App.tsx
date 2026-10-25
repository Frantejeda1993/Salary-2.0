import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { useData } from "./data";
import QuickAdd from "./components/QuickAdd";
import TabBar from "./components/TabBar";
import Tour from "./components/Tour";
import OfflineBanner from "./components/OfflineBanner";
import { parseAmount } from "./lib/money";
import { matchByName, matchWallet, parseShortcutDate, type RawCol } from "./lib/quickadd";
import Denied from "./pages/Denied";
import Login from "./pages/Login";
import MonthPage from "./pages/Month";
import Movements from "./pages/Movements";
import Onboarding from "./pages/Onboarding";
import Plan from "./pages/Plan";
import Settings from "./pages/Settings";
import { UIProvider, useUI } from "./ui";

export default function App() {
  const { status } = useAuth();
  if (status === "loading") return <div className="splash">Cargando…</div>;
  if (status === "signedOut") return <Login />;
  if (status === "denied") return <Denied />;
  if (status === "needsOnboarding") return <Onboarding />;
  return <UIProvider><Shell /></UIProvider>;
}

const screenOf = (path: string) =>
  path.startsWith("/movimientos") ? "movimientos" : path.startsWith("/plan") ? "plan" : path.startsWith("/ajustes") ? "ajustes" : "mes";

function Shell() {
  const { quickAdd, openQuickAdd } = useUI();
  const proxy = useRef<HTMLInputElement>(null);
  const loc = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { ready } = useData();
  // Tour: una vez, tras la bienvenida; Ajustes lo vuelve a lanzar con el evento «salary:tour».
  const [tour, setTour] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (ready && !seen && !(profile as { tourDone?: boolean } | null)?.tourDone && loc.pathname === "/") { setSeen(true); setTour(true); }
  }, [ready, profile, seen, loc.pathname]);
  useEffect(() => {
    const start = () => { navigate("/"); setTour(true); };
    window.addEventListener("salary:tour", start);
    return () => window.removeEventListener("salary:tour", start);
  }, [navigate]);
  return (
    <div className="app">
      <main className="content">
        <OfflineBanner />
        <div className={`screen s-${screenOf(loc.pathname)}`} key={loc.pathname}>
        <Routes>
          <Route path="/" element={<MonthPage />} />
          <Route path="/movimientos" element={<Movements />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/ajustes" element={<Settings />} />
          <Route path="/nuevo" element={<FromShortcut />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </main>
      {/* iOS solo abre el teclado si el foco llega dentro del toque: se enfoca este campo
          invisible al pulsar «+» y la hoja le pasa el foco al importe. */}
      <input ref={proxy} className="focus-proxy" inputMode="decimal" tabIndex={-1} aria-hidden="true" />
      <TabBar onAdd={() => { proxy.current?.focus(); openQuickAdd(); }} />
      {quickAdd && <QuickAdd prefill={quickAdd} />}
      {tour && user && !quickAdd && <Tour uid={user.uid} onClose={() => { setSeen(true); setTour(false); }} />}
    </div>
  );
}

/**
 * Entrada de los atajos: #/nuevo?importe=12,50&comercio=Mercadona&tarjeta=Visa&fecha=2026-10-17
 * (también cuenta=…, o wallet=<nombre en Wallet> para el atajo genérico, que la app aprende). Abre el alta rápida rellena; no guarda nada hasta que confirmas.
 */
function FromShortcut() {
  const { ready, docs } = useData();
  const { openQuickAdd } = useUI();
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams(loc.search);
    const notes: string[] = [];
    const rawAmount = p.get("importe") ?? "";
    if (rawAmount && parseAmount(rawAmount) === null) notes.push(`El atajo envió un importe que no entiendo: «${rawAmount}».`);
    let payWith: string | undefined;
    const cardName = p.get("tarjeta");
    const accName = p.get("cuenta");
    const wallet = p.get("wallet")?.trim() || undefined;
    const walletMatch = wallet ? matchWallet(docs.cards as RawCol, docs.accounts as RawCol, wallet) : null;
    if (wallet) {
      if (walletMatch) payWith = walletMatch;
      else notes.push(`Primera vez que pagas con «${wallet}» de Wallet: elige con qué pagaste y lo recordaré.`);
    } else if (cardName) {
      const id = matchByName(docs.cards as RawCol, cardName);
      if (id) payWith = `card:${id}`; else notes.push(`No encuentro la tarjeta «${cardName}». Elige con qué pagaste.`);
    } else if (accName) {
      const id = matchByName(docs.accounts as RawCol, accName);
      if (id) payWith = `acc:${id}`; else notes.push(`No encuentro la cuenta «${accName}». Elige con qué pagaste.`);
    }
    const date = parseShortcutDate(p.get("fecha")) ?? undefined;
    if (p.get("fecha") && !date) notes.push(`La fecha «${p.get("fecha")}» no es válida; pongo hoy.`);
        const parsed = parseAmount(rawAmount);
    openQuickAdd({ amount: parsed !== null ? String(parsed.toFixed(2)).replace(".", ",") : rawAmount, description: p.get("comercio") ?? "", payWith, date, source: "shortcut", notes, walletName: wallet, walletMatch });
    navigate("/", { replace: true });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="splash">Abriendo…</div>;
}
