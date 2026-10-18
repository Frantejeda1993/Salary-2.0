/** Ajustes: cuentas, categorías, preferencias y tu cuenta de Google. */
import { lazy, Suspense, useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../data";
import AmountInput from "../components/AmountInput";
import { AccountSelect, Errors, Field, TextInput, Warn } from "../components/Form";
import { CardEditor } from "../components/PlanEditors";
import Fold from "../components/Fold";
import ShortcutGuide from "../components/ShortcutGuide";
import ScreenHeader from "../components/ScreenHeader";
import Sheet from "../components/Sheet";
import { createItem, patchItem, patchSettings } from "../lib/actions";
import { groupByBank, monthLong, nameOf, sortedLive } from "../lib/format";
import { formatCents, formatEuros, parseAmount } from "../lib/money";
import { useUI } from "../ui";

// Herramientas del modo prueba: con esta condición literal, Vite elimina el módulo
// (y los datos sintéticos que carga) de la versión publicada.
const MockTools = import.meta.env.VITE_MOCK === "1" ? lazy(() => import("./MockTools")) : null;

const ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone")
  ?? ["Europe/Madrid", "Europe/Berlin", "Europe/London", "America/New_York"];

type Raw = Record<string, unknown>;
type Editing = { kind: "account" | "category" | "main"; id: string | null } | { kind: "card"; id: string | null; accountId: string } | null;

export default function Settings() {
  const { user, profile, signOut } = useAuth();
  const { ready, docs, core, currentMonth, mainAccountId } = useData();
  const { toast } = useUI();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!ready || !core || !profile) return <div className="splash">Cargando tus datos…</div>;
  const settings = profile.settings as unknown as Raw;
  const tz = (settings.timezone as string) ?? "Europe/Madrid";
  const close = () => setEditing(null);
  const cardsOf = (accId: string) => Object.values(docs.cards).filter((c) => c.accountId === accId && !c.archived);

  const allAccounts = Object.entries(docs.accounts).sort(([, a], [, b]) => ((a.order as number) ?? 999) - ((b.order as number) ?? 999));
  const accounts = allAccounts.filter(([, a]) => showArchived || !a.archived);
  const archivedCount = allAccounts.length - sortedLive(docs.accounts).length;
  const live = sortedLive(docs.accounts);
  const liveCount = live.length;
  const liveTotal = live.reduce((t, [id]) => t + core.realBalance(id, currentMonth), 0);
  const liveCats = Object.values(docs.categories).filter((c) => !c.archived).length;
  const catUses = new Map<string, number>();
  for (const m of Object.values(docs.movements)) if (m.categoryId) catUses.set(m.categoryId as string, (catUses.get(m.categoryId as string) ?? 0) + 1);
  const categories = Object.entries(docs.categories).sort(([, a], [, b]) => Number(!!a.archived) - Number(!!b.archived) || String(a.name).localeCompare(String(b.name), "es"));

  return (
    <div className="page">
      <ScreenHeader id="ajustes" />

      <section className="card me">
        <div className="me-row">
          <p><strong>{user?.displayName}</strong><br /><span className="muted">{user?.email}</span></p>
          <button className="btn small" onClick={signOut}>Cerrar sesión</button>
        </div>
      </section>

      <Fold title="Cuentas" total={formatCents(liveTotal)} sub={`${liveCount === 1 ? "1 cuenta" : `${liveCount} cuentas`}, hoy`}>
        {groupByBank(accounts).map(({ bank, accounts: list }) => (
        <section className="bank" key={bank} aria-label={bank}>
        <div className="bank-head"><span>{bank}</span></div>
        <ul className="rows">
          {list.map(([id, a]) => (
            <li key={id} className={a.archived ? "archived" : ""}>
              <button className="what plain" onClick={() => setEditing({ kind: "account", id })}>
                <b>{a.name as string}{id === mainAccountId && <em className="badge">principal</em>}{a.archived ? " (archivada)" : ""}</b>
                <small>Saldo inicial {formatEuros((a.initialBalance as number) ?? 0)}{cardsOf(id).length > 0 && `, ${cardsOf(id).length === 1 ? "1 tarjeta" : `${cardsOf(id).length} tarjetas`}`}</small>
              </button>
              <span className="amt">{formatCents(core.realBalance(id, currentMonth))}<small>hoy</small></span>
            </li>
          ))}
        </ul>
        </section>
        ))}
        <button className="btn wide ghost fold-add" onClick={() => setEditing({ kind: "account", id: null })}>Añadir cuenta</button>
        <div className="row-actions">
          <button className="link" onClick={() => setEditing({ kind: "main", id: null })}>Cambiar la cuenta principal</button>
          {archivedCount > 0 && <button className="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Ocultar archivadas" : `Ver archivadas (${archivedCount})`}</button>}
        </div>
      </Fold>

      <Fold title="Categorías" total={String(liveCats)} sub="activas">
        <p className="muted small">Solo sirven para ordenar y para los budgets: no cambian ningún cálculo.</p>
        <ul className="rows">
          {categories.map(([id, c]) => (
            <li key={id} className={c.archived ? "archived" : ""}>
              <button className="what plain" onClick={() => setEditing({ kind: "category", id })}>
                <b>{c.name as string}{c.archived ? " (archivada)" : ""}</b><small>{(catUses.get(id) ?? 0) === 1 ? "1 movimiento" : `${catUses.get(id) ?? 0} movimientos`}</small>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn wide ghost fold-add" onClick={() => setEditing({ kind: "category", id: null })}>Añadir categoría</button>
      </Fold>

      <Fold title="Apuntar al pagar con Apple Pay" sub="iPhone, con Atajos">
        <ShortcutGuide />
      </Fold>

      <button className="link tour-link" onClick={() => window.dispatchEvent(new Event("salary:tour"))}>Ver el tour de la app</button>

      <details className="secondary">
        <summary>Preferencias y datos técnicos</summary>
        <Field label="Zona horaria" hint="Decide cuándo empieza cada mes y qué día es «hoy».">
          <select className="input" value={tz} onChange={(e) => toast("Zona horaria cambiada", patchSettings(user!.uid, settings, { timezone: e.target.value }))}>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select></Field>
        <p className="muted small">Gestionas desde {monthLong(settings.startMonth as string)}.
          {settings.ownExpensesFrom ? ` Los reembolsos de gastos propios se controlan aquí desde ${monthLong(settings.ownExpensesFrom as string)}.` : ""}</p>
        <div className="field"><span>Tu identificador (uid), para la migración</span>
          <div className="uid">
            <code>{user?.uid}</code>
            <button className="btn small" onClick={() => { navigator.clipboard?.writeText(user!.uid); setCopied(true); }}>{copied ? "Copiado" : "Copiar"}</button>
          </div>
        </div>
        {MockTools && <Suspense fallback={null}><MockTools /></Suspense>}
        <p className="muted small">Salary 2.0, versión {import.meta.env.MODE}</p>
      </details>

      {editing?.kind === "account" && <AccountEditor id={editing.id} onClose={close} onCard={(cardId) => setEditing({ kind: "card", id: cardId, accountId: editing.id! })} />}
      {editing?.kind === "card" && <CardEditor id={editing.id} accountId={editing.accountId} onClose={() => setEditing({ kind: "account", id: editing.accountId })} />}
      {editing?.kind === "category" && <CategoryEditor id={editing.id} onClose={close} />}
      {editing?.kind === "main" && <MainAccountEditor onClose={close} />}
    </div>
  );
}

function AccountEditor({ id, onClose, onCard }: { id: string | null; onClose: () => void; onCard: (cardId: string | null) => void }) {
  const { user } = useAuth();
  const { docs, core, currentMonth, mainAccountId } = useData();
  const { toast } = useUI();
  const a = id ? (docs.accounts[id] as Raw) : null;
  const [name, setName] = useState((a?.name as string) ?? "");
  const [bank, setBank] = useState((a?.bankName as string) ?? "");
  const [initial, setInitial] = useState(a ? String(a.initialBalance ?? 0).replace(".", ",") : "");
  const [tried, setTried] = useState(false);
  const value = initial.trim() === "" ? 0 : parseAmount(initial);
  const errors = [!name.trim() && "Ponle un nombre.", value === null && "El saldo inicial no es un importe."].filter(Boolean) as string[];
  const done = (text: string, undo: () => void) => { toast(text, undo); onClose(); };
  const uid = user!.uid;

  // Lo que sigue usando la cuenta: archivarla no lo cambia, pero dejaría de verse.
  const inUse = id ? [
    ...Object.values(docs.fixedExpenses).filter((f) => f.accountId === id && !f.end).map((f) => `gasto fijo «${f.name}»`),
    ...Object.values(docs.salaries).filter((s) => s.accountId === id && !s.end).map((s) => `nómina «${s.name}»`),
    ...Object.values(docs.budgets).filter((b) => b.accountId === id && !b.end).map(() => "un budget"),
    ...Object.values(docs.cards).filter((c) => c.accountId === id && !c.archived).map((c) => `tarjeta «${c.name}»`),
  ] : [];
  const cards = Object.entries(docs.cards).filter(([, c]) => c.accountId === id)
    .sort(([, x], [, y]) => Number(!!x.archived) - Number(!!y.archived) || String(x.name).localeCompare(String(y.name), "es"));
  const balance = id ? core!.realBalance(id, currentMonth) : 0;
  const initialChanged = !!a && value !== null && Math.round(value * 100) !== Math.round(Number(a.initialBalance ?? 0) * 100);

  return (
    <Sheet title={a ? (a.name as string) : "Nueva cuenta"} onClose={onClose}>
      <Field label="Nombre"><TextInput value={name} onChange={setName} placeholder="Cuenta nómina" /></Field>
      <Field label="Banco"><TextInput value={bank} onChange={setBank} placeholder="Opcional" /></Field>
      <Field label="Saldo inicial" hint="Lo que había en la cuenta antes del primer mes que gestionas.">
        <AmountInput value={initial} onChange={setInitial} ariaLabel="Saldo inicial" /></Field>
      {initialChanged && <Warn>El saldo inicial cambia el saldo de todos los meses, también los cerrados.</Warn>}
      {tried && <Errors list={errors} />}
      {a && <section className="changes">
        <div className="section-head"><h4>Tarjetas de crédito</h4><button className="link" onClick={() => onCard(null)}>Añadir tarjeta</button></div>
        {cards.length === 0 ? <p className="muted small">Ninguna tarjeta se paga desde esta cuenta.</p> : (
          <ul className="rows">
            {cards.map(([cid, c]) => <li key={cid} className={c.archived ? "archived" : ""}><button className="what plain" onClick={() => onCard(cid)}>
              <b>{c.name as string}{c.archived ? " (archivada)" : ""}</b>
              <small>{c.cutoffDay ? `Corte el día ${c.cutoffDay}` : "Se cobra el mes siguiente"}</small></button></li>)}
          </ul>)}
      </section>}
      <button className="btn primary wide save" onClick={() => {
        setTried(true);
        if (errors.length) return;
        const data = { name: name.trim(), bankName: bank.trim() || null, initialBalance: value ?? 0 };
        if (a) done("Cuenta guardada", patchItem(uid, "accounts", id!, data, a));
        else done("Cuenta añadida", createItem(uid, "accounts", { ...data, archived: false, order: Object.keys(docs.accounts).length }).undo);
      }}>{a ? "Guardar" : "Añadir cuenta"}</button>
      {a && id !== mainAccountId && <>
        {!a.archived && inUse.length > 0 && <Warn>Todavía la usan: {inUse.join(", ")}. Archivarla no cambia ningún cálculo, pero dejará de aparecer en las listas.</Warn>}
        {!a.archived && balance !== 0 && <Warn>Tiene un saldo de {formatCents(balance)}: seguirá contando aunque esté archivada.</Warn>}
        <button className="btn wide ghost danger-btn" onClick={() => done(a.archived ? "Cuenta recuperada" : "Cuenta archivada", patchItem(uid, "accounts", id!, { archived: !a.archived }, a))}>
          {a.archived ? "Recuperar cuenta" : "Archivar cuenta"}</button>
      </>}
      {id === mainAccountId && <p className="muted small">Es tu cuenta principal: no se puede archivar.</p>}
    </Sheet>
  );
}

function CategoryEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const { docs } = useData();
  const { toast } = useUI();
  const c = id ? (docs.categories[id] as Raw) : null;
  const [name, setName] = useState((c?.name as string) ?? "");
  const dup = Object.entries(docs.categories).some(([cid, x]) => cid !== id && String(x.name).trim().toLowerCase() === name.trim().toLowerCase());
  const budgets = id ? Object.values(docs.budgets).filter((b) => b.categoryId === id && !b.end).length : 0;
  const done = (text: string, undo: () => void) => { toast(text, undo); onClose(); };
  const uid = user!.uid;
  return (
    <Sheet title={c ? (c.name as string) : "Nueva categoría"} onClose={onClose}>
      <Field label="Nombre"><TextInput value={name} onChange={setName} placeholder="Supermercado" /></Field>
      {dup && <Warn>Ya hay una categoría con ese nombre.</Warn>}
      <button className="btn primary wide save" disabled={!name.trim() || dup} onClick={() => {
        if (c) done("Categoría guardada", patchItem(uid, "categories", id!, { name: name.trim() }, c));
        else done("Categoría añadida", createItem(uid, "categories", { name: name.trim(), archived: false, order: Object.keys(docs.categories).length }).undo);
      }}>{c ? "Guardar" : "Añadir categoría"}</button>
      {c && <>
        {!c.archived && budgets > 0 && <Warn>Tiene {budgets === 1 ? "un budget activo" : `${budgets} budgets activos`}: siguen contando aunque la archives.</Warn>}
        <button className="btn wide ghost danger-btn" onClick={() => done(c.archived ? "Categoría recuperada" : "Categoría archivada", patchItem(uid, "categories", id!, { archived: !c.archived }, c))}>
          {c.archived ? "Recuperar categoría" : "Archivar (los movimientos antiguos la conservan)"}</button>
      </>}
    </Sheet>
  );
}

function MainAccountEditor({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const { docs, mainAccountId } = useData();
  const { toast } = useUI();
  const [acc, setAcc] = useState(mainAccountId ?? "");
  return (
    <Sheet title="Cuenta principal" onClose={onClose}>
      <p className="muted">Es la cuenta del resultado del mes: de ella salen el cierre previsto, el arrastre y los reembolsos de gastos propios.</p>
      <Field label="Cuenta principal"><AccountSelect value={acc} onChange={setAcc} /></Field>
      {acc !== mainAccountId && <Warn>Cambiarla recalcula todos los meses, también los cerrados, con la nueva cuenta. Hoy es {nameOf(docs.accounts, mainAccountId)}.</Warn>}
      <button className="btn primary wide save" disabled={!acc || acc === mainAccountId} onClick={() => {
        toast("Cuenta principal cambiada", patchSettings(user!.uid, profile!.settings as unknown as Raw, { mainAccountId: acc }));
        onClose();
      }}>Usar {nameOf(docs.accounts, acc, "esta cuenta")} como principal</button>
    </Sheet>
  );
}
