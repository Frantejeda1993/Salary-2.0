"""
Conversión inversa: documentos del modelo nuevo -> dict con la forma de
load_all_data() de la app vieja.

Solo sirve para VERIFICAR: alimentar el motor de cálculo viejo con lo que hay
en el destino y comprobar que da exactamente lo mismo que con el origen.
Usa únicamente campos del modelo nuevo (nunca legacy.*), salvo para devolver
datos que el motor viejo no usa en ningún cálculo.
"""
from __future__ import annotations

from datetime import datetime

from .transform import LEGACY_COLLECTIONS


def _dt(s: str | None):
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d")


def to_legacy(profile: dict, docs: dict) -> dict:
    """docs = {colección destino: {id: doc}}. Devuelve listas ordenadas por id."""
    out = {c: [] for c in LEGACY_COLLECTIONS}
    settings = profile.get("settings", {})
    main_id = settings.get("mainAccountId")

    for aid, a in sorted(docs.get("accounts", {}).items()):
        out["accounts"].append({"id": aid, "nombre": a.get("name", ""), "is_main": aid == main_id,
                                "saldo_inicial": a.get("initialBalance", 0.0)})

    for cid, c in sorted(docs.get("categories", {}).items()):
        # D8: el tipo ya no existe. 'normal' para todas: el motor viejo solo lo usa
        # en category_spending (vista neta), que no forma parte de la verificación.
        out["categories"].append({"id": cid, "nombre": c.get("name", ""), "tipo": "normal"})

    for sid, s in sorted(docs.get("salaries", {}).items()):
        legacy_s = {
            "id": sid, "nombre": s.get("name", ""), "salario_bruto": s.get("grossMonthly", 0.0),
            "fecha_inicio": _dt(s.get("start")), "fecha_fin": _dt(s.get("end")),
            "account_id": s.get("accountId"),
            "deductions": [{"name": d.get("name"), "percentage": d.get("rate", 0.0),
                            "applies_to_extras": d.get("appliesToExtras", False)}
                           for d in s.get("deductions", [])],
        }
        if s.get("revisions"):
            legacy_s["revisiones"] = [
                {"desde": r["from"], "salario_bruto": r["gross"], **({"cobro_desde": r["paidFrom"]}
                                                                    if r.get("paidFrom") else {})}
                for r in s["revisions"]
            ]
        out["salaries"].append(legacy_s)
        for o in s.get("overtimes", []):
            out["overtimes"].append({"id": o["id"], "salary_id": sid, "mes_aplicacion": o["month"],
                                     "monto_bruto": o["gross"]})
    out["overtimes"].sort(key=lambda o: o["id"])

    for fid, f in sorted(docs.get("fixedExpenses", {}).items()):
        legacy_f = {"id": fid, "nombre": f.get("name", ""), "monto": f.get("amount", 0.0),
                    "fecha_inicio": _dt(f.get("start")), "fecha_fin": _dt(f.get("end")),
                    "account_id": f.get("accountId"), "es_propio": f.get("isOwnExpense", False)}
        if f.get("revisions"):
            revs = []
            for r in f["revisions"]:
                rev = {"desde": r["from"]}
                if "amount" in r:
                    rev["monto"] = r["amount"]
                if "accountId" in r:
                    rev["account_id"] = r["accountId"]
                if "legacyBankId" in r:
                    rev["bank_id"] = r["legacyBankId"]
                revs.append(rev)
            legacy_f["revisiones"] = revs
        out["fixed_expenses"].append(legacy_f)
        for mes, p in sorted(f.get("payments", {}).items()):
            out["fixed_expense_instances"].append({
                "id": p.get("legacyId") or f"{fid}_{mes}", "fixed_expense_id": fid, "mes": mes,
                "estado": "pagado" if p["status"] == "paid" else "impagado", "monto": p.get("amount")})
    out["fixed_expense_instances"].sort(key=lambda i: i["id"])

    for bid, b in sorted(docs.get("budgets", {}).items()):
        out["budgets"].append({"id": bid, "categoria_id": b.get("categoryId"), "account_id": b.get("accountId"),
                               "monto": b["amount"], "fecha_inicio": _dt(b.get("start")),
                               "fecha_fin": _dt(b.get("end"))})

    for mid, m in sorted(docs.get("movements", {}).items()):
        if m["type"] == "expense":
            e = {"id": mid, "nombre": m.get("description", ""), "fecha": _dt(m["date"]), "monto": m["amount"],
                 "categoria_id": m.get("categoryId") or "", "account_id": m.get("accountId")}
            if m.get("card"):
                e.update({"metodo_pago": "credito", "mes_cargo": m["card"]["chargeMonth"],
                          "reservar_en": "cargo" if m["card"]["reserveIn"] == "charge" else "compra"})
            if m.get("fuel"):
                e.update({"fuel_expense": True, "km_done": m["fuel"]["km"],
                          "price_per_l": m["fuel"]["pricePerLiter"]})
            out["expenses"].append(e)
        elif m["type"] == "income":
            out["incomes"].append({"id": mid, "nombre": m.get("description", ""), "fecha": _dt(m["date"]),
                                   "monto": m["amount"], "categoria_id": m.get("categoryId") or "",
                                   "account_id": m.get("accountId")})
        elif m["type"] == "transfer":
            t = {"id": mid, "fecha": _dt(m["date"]), "cuenta_origen": m.get("accountId"),
                 "cuenta_destino": m.get("toAccountId"), "monto": m["amount"],
                 "descripcion": m.get("description", ""), "is_loan": m.get("transferKind") == "loan"}
            if m.get("loan"):
                t.update({"status": m["loan"]["status"], "outstanding_amount": m["loan"]["outstanding"]})
            out["transfers"].append(t)

    for sid, st in sorted(docs.get("cardSettlements", {}).items()):
        out["credit_settlements"].append({"id": (st.get("legacy") or {}).get("id") or sid,
                                          "account_id": st["accountId"],
                                          "mes_cargo": st["chargeMonth"], "fecha": _dt(st["date"]),
                                          "monto": st["amount"]})
    # Mismo orden que en el origen (por id viejo): el orden de suma importa para el último decimal.
    out["credit_settlements"].sort(key=lambda s: s["id"])
    return out
