"""
Listado para decidir el histórico de gastos propios (decisión D3, opción b).

Para cada cuenta no principal con gastos fijos propios y cada mes: lo que se debía
(gastos propios marcados como pagados), los reembolsos automáticos que ya ve la app
y las demás transferencias de la principal a esa cuenta, que pueden haber sido
reembolsos hechos a mano. Solo lee el backup; no escribe nada.
"""
from __future__ import annotations

from .serde import month_str
from .transform import AUTO_TRANSFER_DESCRIPTION, add_months


def _field_for_month(fe: dict, field: str, month: str):
    value = fe.get(field)
    for rev in sorted(fe.get("revisiones") or [], key=lambda r: r["desde"]):
        if rev["desde"] <= month and rev.get(field) is not None:
            value = rev[field]
    return value


def _active(fe: dict, month: str) -> bool:
    start = month_str(fe["fecha_inicio"])
    end = month_str(fe["fecha_fin"]) if fe.get("fecha_fin") else None
    return start <= month and (end is None or end >= month)


def own_expenses_report(legacy: dict, current: str) -> dict:
    accounts = {a["id"]: a.get("nombre", a["id"]) for a in legacy.get("accounts", [])}
    main = next((a["id"] for a in legacy.get("accounts", []) if a.get("is_main")), None)
    own = [f for f in legacy.get("fixed_expenses", []) if f.get("es_propio")]
    inst = {(i.get("fixed_expense_id"), i.get("mes")): i for i in legacy.get("fixed_expense_instances", [])}
    if not own or not main:
        return {"main": main, "accounts": {}}
    first = min(month_str(f["fecha_inicio"]) for f in own)
    months, m = [], first
    while m <= current:
        months.append(m)
        m = add_months(m, 1)

    out: dict = {}
    for m in months:
        for f in own:
            if not _active(f, m):
                continue
            acc = _field_for_month(f, "account_id", m)
            if not acc or acc == main:
                continue
            row = out.setdefault(acc, {}).setdefault(m, {"owed": 0.0, "items": [], "auto": [], "other": []})
            i = inst.get((f["id"], m))
            paid = i is not None and i.get("estado") == "pagado"
            amount = (i.get("monto") if i and i.get("monto") is not None else _field_for_month(f, "monto", m)) or 0.0
            row["items"].append({"name": f.get("nombre", ""), "amount": amount,
                                 "status": "pagado" if paid else ("impagado" if i else "sin marcar")})
            if paid or m >= current:
                row["owed"] += amount
    for t in legacy.get("transfers", []):
        acc = t.get("cuenta_destino")
        if t.get("cuenta_origen") != main or acc not in out or t.get("is_loan"):
            continue
        m = month_str(t["fecha"])
        row = out[acc].setdefault(m, {"owed": 0.0, "items": [], "auto": [], "other": []})
        entry = {"id": t["id"], "date": str(t["fecha"])[:10], "amount": t.get("monto", 0.0)}
        (row["auto"] if t.get("descripcion") == AUTO_TRANSFER_DESCRIPTION else row["other"]).append(entry)
    return {"main": main, "accounts": {acc: dict(sorted(rows.items())) for acc, rows in out.items()},
            "names": accounts}


def print_report(rep: dict):
    eur = lambda v: f"{v:>9,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if not rep["accounts"]:
        print("No hay gastos propios en cuentas no principales.")
        return
    print(f"Cuenta principal: {rep['names'].get(rep['main'], rep['main'])}\n")
    for acc, rows in rep["accounts"].items():
        print(f"■ Gastos propios cargados en «{rep['names'].get(acc, acc)}» — reembolsos desde la principal")
        print(f"   {'mes':<8} {'se debía':>9} {'reemb.auto':>10} {'acumulado*':>10}   gastos propios del mes · otras transferencias principal → esta cuenta")
        running = 0.0
        for m, r in rows.items():
            auto = sum(x["amount"] for x in r["auto"])
            running += r["owed"] - auto
            items = ", ".join(f"{x['name']} {eur(x['amount']).strip()} ({x['status']})" for x in r["items"]) or "—"
            others = "; ".join(f"[{x['id'][:8]}] {x['date']} {eur(x['amount']).strip()} €" for x in r["other"])
            print(f"   {m:<8} {eur(r['owed'])} {eur(auto):>10} {eur(running):>10}   {items}")
            if others:
                print(f"   {'':<41}   ↳ otras transferencias: {others}")
        print("   * acumulado = pendiente si solo contaran los reembolsos automáticos (lo que calcula hoy el motor corregido)\n")
