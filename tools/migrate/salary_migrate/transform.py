"""
Transformación del modelo viejo (colecciones en la raíz) al nuevo (users/{uid}/...).

Entrada : `legacy` = {colección: [ {"id": ..., **campos}, ... ]} ordenado por id,
          tal como sale del backup.
Salida  : Plan con los documentos destino, avisos y errores.

Principios (spec Fase 1, sección 5):
  * Se conservan los ids viejos.
  * No se recalcula nada: los valores que el motor viejo deduce por defecto
    (mes de cargo, pendiente de préstamo, deducciones legacy) se materializan
    con el MISMO resultado que obtendría el motor viejo.
  * Ningún campo se pierde: lo que no tiene sitio en el modelo nuevo se guarda
    en `legacy.extra`.
  * Ante datos ambiguos, error y parada; nunca se "arregla" en silencio.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .serde import date_str, is_midnight_utc, iso_or_none, month_str

AUTO_TRANSFER_DESCRIPTION = "Transferencia automatica gastos"

LEGACY_COLLECTIONS = [
    "accounts", "banks", "salaries", "overtimes", "expenses", "incomes", "transfers",
    "categories", "budgets", "fixed_expenses", "fixed_expense_instances",
    "monthly_account_snapshots", "credit_settlements",
]

# Colecciones del destino bajo users/{uid}/ (el perfil users/{uid} va aparte).
TARGET_COLLECTIONS = [
    "accounts", "cards", "categories", "salaries", "fixedExpenses", "budgets",
    "movements", "cardSettlements",
]

# Campos que cada colección vieja puede tener. Lo demás va a legacy.extra.
KNOWN_FIELDS = {
    "banks": {"nombre", "duenio", "created_at"},
    "accounts": {"bank_id", "nombre", "saldo_inicial", "is_main", "created_at"},
    "categories": {"nombre", "tipo", "created_at"},
    "salaries": {"nombre", "salario_bruto", "fecha_inicio", "fecha_fin", "bank_id", "account_id",
                 "deductions", "revisiones", "created_at",
                 "cont_comun", "cont_comun_aplica_extras", "mei", "mei_aplica_extras",
                 "formacion", "formacion_aplica_extras", "desempleo", "desempleo_aplica_extras",
                 "irpf", "irpf_aplica_extras"},
    "overtimes": {"salary_id", "monto_bruto", "mes_aplicacion", "created_at"},
    "expenses": {"nombre", "fecha", "monto", "categoria_id", "bank_id", "account_id", "metodo_pago",
                 "mes_cargo", "reservar_en", "created_at", "fuel_expense", "km_done", "price_per_l"},
    "incomes": {"nombre", "fecha", "monto", "categoria_id", "bank_id", "account_id", "created_at"},
    "transfers": {"fecha", "cuenta_origen", "cuenta_destino", "monto", "is_loan", "status",
                  "outstanding_amount", "descripcion", "created_at"},
    "budgets": {"categoria_id", "monto", "fecha_inicio", "fecha_fin", "bank_id", "account_id", "created_at"},
    "fixed_expenses": {"nombre", "monto", "fecha_inicio", "fecha_fin", "bank_id", "account_id",
                       "es_propio", "revisiones", "created_at"},
    "fixed_expense_instances": {"fixed_expense_id", "mes", "estado", "monto"},
    "credit_settlements": {"account_id", "mes_cargo", "fecha", "monto", "created_at"},
}

# Campos que la app vieja ya no usa y que Francisco ha confirmado como restos de
# una versión anterior: no se migran (siguen en el backup) y se avisa una sola vez.
IGNORED_FIELDS = {
    "expenses": {"es_propio"},   # confirmado 17-oct-2026: error de una versión antigua
}

# Esquema legacy de deducciones (copiado de models/salary.py de la app vieja).
LEGACY_DEDUCTION_FIELDS = [
    ("Cont. Común", "cont_comun", "cont_comun_aplica_extras", 15.0),
    ("MEI", "mei", "mei_aplica_extras", 0.1),
    ("Formación", "formacion", "formacion_aplica_extras", 0.1),
    ("Desempleo", "desempleo", "desempleo_aplica_extras", 0.1),
    ("IRPF", "irpf", "irpf_aplica_extras", 0.0),
]


def normalize_deductions(data: dict) -> list[dict]:
    """Copia exacta de models.salary.normalize_deductions de la app vieja."""
    deductions = data.get("deductions")
    if deductions is not None:
        return list(deductions)
    if not any(key in data for _, key, _, _ in LEGACY_DEDUCTION_FIELDS):
        return []
    return [
        {
            "name": name,
            "percentage": float(data.get(val_key, default_val)) / 100.0,
            "applies_to_extras": bool(data.get(extra_key, True)),
        }
        for name, val_key, extra_key, default_val in LEGACY_DEDUCTION_FIELDS
    ]


def add_months(month: str, n: int) -> str:
    y, m = map(int, month.split("-"))
    idx = y * 12 + (m - 1) + n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def card_id_for(account_id: str) -> str:
    return f"card_{account_id}"


def settlement_id(card_id: str, month: str) -> str:
    return f"{card_id}_{month}"


@dataclass
class Plan:
    uid: str
    profile: dict
    docs: dict = field(default_factory=lambda: {c: {} for c in TARGET_COLLECTIONS})
    errors: list = field(default_factory=list)      # bloquean la escritura
    warnings: list = field(default_factory=list)    # se informan y se guardan en meta/migration

    def error(self, code: str, msg: str, **ctx):
        self.errors.append({"code": code, "message": msg, **ctx})

    def warn(self, code: str, msg: str, **ctx):
        self.warnings.append({"code": code, "message": msg, **ctx})

    @property
    def ok(self) -> bool:
        return not self.errors


# --------------------------------------------------------------------------- helpers

def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class _Ctx:
    def __init__(self, plan: Plan, legacy: dict):
        self.plan = plan
        self.legacy = legacy
        self.ids = {c: {d["id"] for d in legacy.get(c, [])} for c in LEGACY_COLLECTIONS}
        self.ignored: dict = {}

    def legacy_block(self, coll: str, doc: dict, **more) -> dict:
        ignored = IGNORED_FIELDS.get(coll, set())
        for k in ignored & set(doc):
            self.ignored[(coll, k)] = self.ignored.get((coll, k), 0) + 1
        extra = {k: v for k, v in doc.items()
                 if k != "id" and k not in KNOWN_FIELDS.get(coll, set()) and k not in ignored}
        block = {"collection": coll, **{k: v for k, v in more.items() if v is not None}}
        for k, v in extra.items():
            if isinstance(v, dict) and v.get("__type") == "repr":
                self.plan.error("unsupported_type", f"Tipo de dato no soportado en {coll}/{doc['id']}.{k}",
                                collection=coll, id=doc["id"], field=k)
        if extra:
            block["extra"] = extra
            self.plan.warn("unknown_fields", f"{coll}/{doc['id']} tiene campos desconocidos: {sorted(extra)}. "
                           "Se conservan en legacy.extra.", collection=coll, id=doc["id"], fields=sorted(extra))
        return block

    def required_number(self, coll, doc, key):
        v = doc.get(key)
        if not _is_number(v):
            self.plan.error("missing_amount", f"{coll}/{doc['id']}: '{key}' falta o no es numérico ({v!r}).",
                            collection=coll, id=doc["id"], field=key)
            return 0.0
        return v

    def required_date(self, coll, doc, key):
        v = doc.get(key)
        if v is None or v == "":
            self.plan.error("missing_date", f"{coll}/{doc['id']}: falta '{key}'.",
                            collection=coll, id=doc["id"], field=key)
            return None
        try:
            s = date_str(v)
        except (ValueError, TypeError):
            self.plan.error("bad_date", f"{coll}/{doc['id']}: '{key}' no es una fecha ({v!r}).",
                            collection=coll, id=doc["id"], field=key)
            return None
        if not is_midnight_utc(v):
            self.plan.warn("non_midnight_date", f"{coll}/{doc['id']}: '{key}' = {v} no es medianoche UTC. "
                           f"Se toma el día UTC {s}, igual que la app vieja.", collection=coll, id=doc["id"])
        return s

    def optional_date(self, coll, doc, key):
        if doc.get(key) in (None, ""):
            return None
        return self.required_date(coll, doc, key)

    def ref(self, coll, doc, key, target_coll, required=True):
        v = doc.get(key)
        if v in (None, ""):
            if required:
                self.plan.warn("empty_ref", f"{coll}/{doc['id']}: '{key}' vacío.", collection=coll, id=doc["id"])
            return None
        if v not in self.ids.get(target_coll, set()):
            self.plan.warn("orphan_ref", f"{coll}/{doc['id']}: '{key}'={v} no existe en {target_coll}. "
                           "Se conserva el id tal cual.", collection=coll, id=doc["id"], ref=v)
        return v


# --------------------------------------------------------------------------- transform

def transform(legacy: dict, uid: str, min_managed_month: str, timezone: str = "Europe/Madrid",
              own_expenses_from: str | None = None, refund_transfers: list | None = None) -> Plan:
    """Convierte el snapshot viejo en un Plan de escritura para users/{uid}.

    own_expenses_from: mes desde el que los reembolsos de gastos propios se controlan en la
        app (antes se hacían fuera y se dan por saldados). Decisión D3, 17-oct-2026.
    refund_transfers: ids (o prefijos únicos de 6+ caracteres) de transferencias normales que
        fueron reembolsos de gastos propios; se marcan transferKind = ownExpenseRefund.
        La descripción no se toca: el motor viejo (y la verificación) no cambian.
    """
    plan = Plan(uid=uid, profile={})
    ctx = _Ctx(plan, legacy)
    L = {c: legacy.get(c, []) for c in LEGACY_COLLECTIONS}
    D = plan.docs

    refund_ids = _resolve_refunds(legacy, refund_transfers or [], plan)

    for name in sorted(set(legacy) - set(LEGACY_COLLECTIONS)):
        plan.warn("unexpected_collection", f"La colección '{name}' ({len(legacy[name])} docs) no la usa la app "
                  "vieja; no se migra. Está en el backup.", collection=name)

    for coll in LEGACY_COLLECTIONS:
        ids = [d["id"] for d in L[coll]]
        if len(ids) != len(set(ids)):
            plan.error("duplicate_id", f"Ids repetidos en {coll}.", collection=coll)

    # ----- cuentas y cuenta principal
    banks = {b["id"]: b for b in L["banks"]}
    mains = [a["id"] for a in L["accounts"] if a.get("is_main", False)]
    if len(mains) != 1:
        plan.error("main_account", f"Debe haber exactamente 1 cuenta principal y hay {len(mains)}: {mains}.",
                   ids=mains)
    main_id = mains[0] if mains else None

    for a in L["accounts"]:
        bank_id = a.get("bank_id")
        bank = banks.get(bank_id)
        if bank_id and not bank:
            plan.warn("orphan_ref", f"accounts/{a['id']}: banco {bank_id} no existe.", collection="accounts",
                      id=a["id"], ref=bank_id)
        saldo = a.get("saldo_inicial", 0.0)
        if not _is_number(saldo):
            plan.error("missing_amount", f"accounts/{a['id']}: saldo_inicial no numérico ({saldo!r}).",
                       collection="accounts", id=a["id"])
            saldo = 0.0
        D["accounts"][a["id"]] = {
            "name": a.get("nombre", ""),
            "bankName": bank.get("nombre") if bank else None,
            "initialBalance": saldo,
            "archived": False,
            "createdAt": iso_or_none(a.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("accounts", a, bankId=bank_id,
                                       bankOwner=bank.get("duenio") if bank else None),
        }
    for b in L["banks"]:
        ctx.legacy_block("banks", b)  # solo para avisar de campos raros

    # ----- categorías (D8: sin tipo; se guarda el viejo solo como traza)
    for c in L["categories"]:
        D["categories"][c["id"]] = {
            "name": c.get("nombre", ""),
            "archived": False,
            "createdAt": iso_or_none(c.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("categories", c, kind=c.get("tipo", "normal")),
        }

    # ----- salarios + horas extra embebidas
    ots_by_salary: dict = {}
    for o in L["overtimes"]:
        if o.get("salary_id") not in ctx.ids["salaries"]:
            plan.warn("orphan_overtime", f"overtimes/{o['id']}: salario {o.get('salary_id')} no existe. "
                      "No se migra (no afecta a ningún cálculo).", collection="overtimes", id=o["id"])
            continue
        if not o.get("mes_aplicacion"):
            plan.error("missing_month", f"overtimes/{o['id']}: falta mes_aplicacion.", collection="overtimes",
                       id=o["id"])
        ots_by_salary.setdefault(o["salary_id"], []).append({
            "id": o["id"],
            "month": o.get("mes_aplicacion", ""),
            "gross": ctx.required_number("overtimes", o, "monto_bruto"),
            "createdAt": iso_or_none(o.get("created_at")),
            **({"legacy": ctx.legacy_block("overtimes", o)} if set(o) - KNOWN_FIELDS["overtimes"] - {"id"} else {}),
        })

    for s in L["salaries"]:
        deductions = [{
            "name": d.get("name"),
            "rate": d.get("percentage", 0.0),
            "appliesToExtras": bool(d.get("applies_to_extras", False)),
        } for d in normalize_deductions(s)]
        if "deductions" not in s and deductions:
            plan.warn("legacy_deductions", f"salaries/{s['id']}: deducciones en esquema legacy; se materializan "
                      f"con el mismo resultado: {[(d['name'], d['rate']) for d in deductions]}.",
                      collection="salaries", id=s["id"])
        revisions = []
        revs_ok = [r for r in (s.get("revisiones") or []) if r.get("desde") and _is_number(r.get("salario_bruto"))]
        if len(revs_ok) != len(s.get("revisiones") or []):
            plan.error("bad_revision", f"salaries/{s['id']}: hay revisiones sin 'desde' o 'salario_bruto'.",
                       collection="salaries", id=s["id"])
        for r in sorted(revs_ok, key=lambda r: r["desde"]):
            rev = {"from": r["desde"], "gross": r["salario_bruto"]}
            if r.get("cobro_desde"):
                rev["paidFrom"] = r["cobro_desde"]
            revisions.append(rev)
        gross = s.get("salario_bruto", 0.0)
        D["salaries"][s["id"]] = {
            "name": s.get("nombre", ""),
            "grossMonthly": gross,
            "start": ctx.required_date("salaries", s, "fecha_inicio"),
            "end": ctx.optional_date("salaries", s, "fecha_fin"),
            "accountId": ctx.ref("salaries", s, "account_id", "accounts"),
            "deductions": deductions,
            "revisions": revisions,
            "overtimes": sorted(ots_by_salary.get(s["id"], []), key=lambda o: o["id"]),
            "createdAt": iso_or_none(s.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("salaries", s, bankId=s.get("bank_id")),
        }

    # ----- gastos fijos + pagos embebidos
    instances: dict = {}
    for i in L["fixed_expense_instances"]:
        fe_id, mes = i.get("fixed_expense_id"), i.get("mes")
        if fe_id not in ctx.ids["fixed_expenses"]:
            plan.warn("orphan_instance", f"fixed_expense_instances/{i['id']}: gasto fijo {fe_id} no existe. "
                      "No se migra (la app vieja tampoco lo cuenta).", collection="fixed_expense_instances",
                      id=i["id"])
            continue
        if not mes:
            plan.error("missing_month", f"fixed_expense_instances/{i['id']}: falta 'mes'.",
                       collection="fixed_expense_instances", id=i["id"])
            continue
        if i.get("estado") not in ("pagado", "impagado"):
            plan.error("bad_status", f"fixed_expense_instances/{i['id']}: estado {i.get('estado')!r} desconocido.",
                       collection="fixed_expense_instances", id=i["id"])
            continue
        key = (fe_id, mes)
        if key in instances:
            plan.error("duplicate_instance", f"Gasto fijo {fe_id} tiene 2+ instancias en {mes}: "
                       f"{instances[key]['legacyId']} y {i['id']} (bug B7). Decide cuál se queda.",
                       ids=[instances[key]["legacyId"], i["id"]])
            continue
        monto = i.get("monto")
        if monto is not None and not _is_number(monto):
            plan.error("missing_amount", f"fixed_expense_instances/{i['id']}: monto no numérico ({monto!r}).",
                       collection="fixed_expense_instances", id=i["id"])
        instances[key] = {"status": "paid" if i["estado"] == "pagado" else "unpaid",
                          "amount": monto, "legacyId": i["id"]}
        if set(i) - KNOWN_FIELDS["fixed_expense_instances"] - {"id"}:
            instances[key]["legacy"] = ctx.legacy_block("fixed_expense_instances", i)

    for fe in L["fixed_expenses"]:
        start = ctx.required_date("fixed_expenses", fe, "fecha_inicio")
        end = ctx.optional_date("fixed_expenses", fe, "fecha_fin")
        payments = {mes: p for (fid, mes), p in sorted(instances.items()) if fid == fe["id"]}
        for mes, p in payments.items():
            if start and (mes < start[:7] or (end and mes > end[:7])):
                paid = p["status"] == "paid"
                plan.warn("payment_outside_period" if paid else "unpaid_mark_outside_period",
                          f"fixed_expenses/{fe['id']}: marca de {'PAGADO' if paid else 'impagado'} en {mes}, fuera de su "
                          f"periodo {start[:7]}–{end[:7] if end else '…'}. "
                          + ("Resta en el saldo real de la app vieja (bug B6). " if paid else "No afecta a ningún cálculo. ")
                          + "Se migra tal cual.", collection="fixed_expenses", id=fe["id"], month=mes)
        revisions = []
        revs_ok = [r for r in (fe.get("revisiones") or []) if r.get("desde")]
        if len(revs_ok) != len(fe.get("revisiones") or []):
            plan.error("bad_revision", f"fixed_expenses/{fe['id']}: hay revisiones sin 'desde'.",
                       collection="fixed_expenses", id=fe["id"])
        for r in sorted(revs_ok, key=lambda r: r["desde"]):
            rev = {"from": r["desde"]}
            if r.get("monto") is not None:
                rev["amount"] = r["monto"]
            if r.get("account_id") is not None:
                rev["accountId"] = r["account_id"]
            if r.get("bank_id") is not None:
                rev["legacyBankId"] = r["bank_id"]
            revisions.append(rev)
        D["fixedExpenses"][fe["id"]] = {
            "name": fe.get("nombre", ""),
            "amount": fe.get("monto", 0.0),
            "start": start,
            "end": end,
            "accountId": ctx.ref("fixed_expenses", fe, "account_id", "accounts"),
            "isOwnExpense": bool(fe.get("es_propio", False)),
            "revisions": revisions,
            "payments": payments,
            "createdAt": iso_or_none(fe.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("fixed_expenses", fe, bankId=fe.get("bank_id")),
        }

    # ----- budgets
    seen_budget: dict = {}
    for b in L["budgets"]:
        key = (b.get("categoria_id"), b.get("account_id"))
        lo = month_str(b["fecha_inicio"]) if b.get("fecha_inicio") else "0000-00"
        hi = month_str(b["fecha_fin"]) if b.get("fecha_fin") else "9999-12"
        for other_id, o_lo, o_hi in seen_budget.get(key, []):
            if lo <= o_hi and o_lo <= hi:
                plan.warn("duplicate_budget", f"budgets/{other_id} y budgets/{b['id']} son de la misma categoría "
                          f"y cuenta y se solapan en {max(lo, o_lo)}–{min(hi, o_hi)}: ahí el gasto cuenta dos veces "
                          "(bug B3). Se migran ambos para conservar los números actuales.", ids=[other_id, b["id"]])
        seen_budget.setdefault(key, []).append((b["id"], lo, hi))
        D["budgets"][b["id"]] = {
            "categoryId": ctx.ref("budgets", b, "categoria_id", "categories"),
            "accountId": ctx.ref("budgets", b, "account_id", "accounts"),
            "amount": ctx.required_number("budgets", b, "monto"),
            "start": ctx.required_date("budgets", b, "fecha_inicio"),
            "end": ctx.optional_date("budgets", b, "fecha_fin"),
            "createdAt": iso_or_none(b.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("budgets", b, bankId=b.get("bank_id")),
        }

    # ----- movimientos: gastos, ingresos, transferencias
    card_accounts: set = set()
    for e in L["expenses"]:
        date = ctx.required_date("expenses", e, "fecha")
        mp = e.get("metodo_pago", "")
        if mp not in ("", None, "credito"):
            plan.warn("unknown_payment_method", f"expenses/{e['id']}: metodo_pago {mp!r} desconocido; la app "
                      "vieja lo trata como pago al contado y así se migra.", collection="expenses", id=e["id"])
        doc = {
            "type": "expense",
            "date": date,
            "amount": ctx.required_number("expenses", e, "monto"),
            "description": e.get("nombre", ""),
            "categoryId": ctx.ref("expenses", e, "categoria_id", "categories", required=False),
            "accountId": ctx.ref("expenses", e, "account_id", "accounts"),
            "createdAt": iso_or_none(e.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("expenses", e, bankId=e.get("bank_id"),
                                       paymentMethod=mp if mp not in ("", None, "credito") else None),
        }
        if mp == "credito":
            res = e.get("reservar_en", "compra")
            if res not in ("compra", "cargo"):
                plan.warn("unknown_reserve", f"expenses/{e['id']}: reservar_en {res!r} desconocido; la app "
                          "vieja lo trata como 'compra' y así se migra.", collection="expenses", id=e["id"])
            charge = e.get("mes_cargo") or (add_months(date[:7], 1) if date else None)
            acc = e.get("account_id")
            card_accounts.add(acc)
            doc["card"] = {"cardId": card_id_for(acc), "chargeMonth": charge,
                           "reserveIn": "charge" if res == "cargo" else "purchase"}
        if e.get("fuel_expense"):
            doc["fuel"] = {"km": e.get("km_done", 0.0), "pricePerLiter": e.get("price_per_l", 0.0)}
        D["movements"][e["id"]] = doc

    for i in L["incomes"]:
        D["movements"][i["id"]] = {
            "type": "income",
            "date": ctx.required_date("incomes", i, "fecha"),
            "amount": ctx.required_number("incomes", i, "monto"),
            "description": i.get("nombre", ""),
            "categoryId": ctx.ref("incomes", i, "categoria_id", "categories", required=False),
            "accountId": ctx.ref("incomes", i, "account_id", "accounts"),
            "createdAt": iso_or_none(i.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("incomes", i, bankId=i.get("bank_id")),
        }

    for t in L["transfers"]:
        amount = ctx.required_number("transfers", t, "monto")
        is_loan = bool(t.get("is_loan", False))
        desc = t.get("descripcion", "")
        doc = {
            "type": "transfer",
            "date": ctx.required_date("transfers", t, "fecha"),
            "amount": amount,
            "description": desc,
            "accountId": ctx.ref("transfers", t, "cuenta_origen", "accounts"),
            "toAccountId": ctx.ref("transfers", t, "cuenta_destino", "accounts"),
            "transferKind": "loan" if is_loan else ("ownExpenseRefund" if desc == AUTO_TRANSFER_DESCRIPTION
                                                    or t["id"] in refund_ids else "normal"),
            "createdAt": iso_or_none(t.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("transfers", t,
                                       status=None if is_loan else t.get("status"),
                                       outstandingAmount=None if is_loan else t.get("outstanding_amount")),
        }
        if is_loan:
            # Mismo default que el motor viejo: outstanding_amount o, si falta, el importe.
            doc["loan"] = {"status": t.get("status", "pending"),
                           "outstanding": t.get("outstanding_amount", t.get("monto", 0.0))}
        D["movements"][t["id"]] = doc

    total_movs = len(L["expenses"]) + len(L["incomes"]) + len(L["transfers"])
    if len(D["movements"]) != total_movs:
        plan.error("id_collision", "Hay ids repetidos entre expenses, incomes y transfers; no caben en "
                   "una sola colección movements sin renombrar.")

    # ----- pagos de tarjeta
    seen_settle: dict = {}
    for st in L["credit_settlements"]:
        acc, mes = st.get("account_id"), st.get("mes_cargo")
        if not acc or not mes:
            plan.error("bad_settlement", f"credit_settlements/{st['id']}: falta account_id o mes_cargo.",
                       collection="credit_settlements", id=st["id"])
            continue
        key = (acc, mes)
        if key in seen_settle:
            plan.error("duplicate_settlement", f"La deuda de tarjeta de {acc} para {mes} está saldada 2+ veces: "
                       f"{seen_settle[key]} y {st['id']} (bug B5). Decide cuál se queda.",
                       ids=[seen_settle[key], st["id"]])
            continue
        seen_settle[key] = st["id"]
        card_accounts.add(acc)
        cid = card_id_for(acc)
        D["cardSettlements"][settlement_id(cid, mes)] = {
            "cardId": cid,
            "accountId": ctx.ref("credit_settlements", st, "account_id", "accounts"),
            "chargeMonth": mes,
            "date": ctx.required_date("credit_settlements", st, "fecha"),
            "amount": ctx.required_number("credit_settlements", st, "monto"),
            "createdAt": iso_or_none(st.get("created_at")),
            "source": "migration",
            "legacy": ctx.legacy_block("credit_settlements", st, id=st["id"]),
        }

    # ----- tarjetas (nuevas): una por cuenta con compras a crédito o pagos de tarjeta
    acc_names = {a["id"]: a.get("nombre", "") for a in L["accounts"]}
    for acc in sorted(a for a in card_accounts if a):
        D["cards"][card_id_for(acc)] = {
            "name": f"Tarjeta {acc_names.get(acc, acc)}".strip(),
            "accountId": acc,
            "cutoffDay": None,
            "chargeOffsetMonths": 1,
            "defaultReserveIn": "purchase",
            "archived": False,
            "source": "migration",
        }
    if None in card_accounts or "" in card_accounts:
        plan.error("card_without_account", "Hay compras a crédito sin cuenta: no se puede asignar tarjeta.")

    # ----- snapshots: solo en el backup
    if L["monthly_account_snapshots"]:
        plan.warn("snapshots_skipped", f"{len(L['monthly_account_snapshots'])} documentos de "
                  "monthly_account_snapshots no se migran (ningún cálculo los usa). Están en el backup.")

    for (coll, k), n in sorted(ctx.ignored.items()):
        plan.warn("ignored_field", f"'{k}' en {n} documento(s) de {coll}: resto de una versión antigua, "
                  "no se migra (está en el backup).", collection=coll, field=k, count=n)

    # ----- perfil
    plan.profile = {
        "settings": {
            # Mismo significado que min_managed_month de la app vieja:
            # los meses <= startMonth no reciben arrastre del anterior.
            "startMonth": min_managed_month,
            **({"ownExpensesFrom": own_expenses_from} if own_expenses_from else {}),
            "mainAccountId": main_id,
            "timezone": timezone,
            "currency": "EUR",
            "locale": "es-ES",
            "features": {
                "ownExpenses": any(f.get("es_propio") for f in L["fixed_expenses"]),
                "fuel": any(e.get("fuel_expense") for e in L["expenses"]),
                "loans": any(t.get("is_loan") for t in L["transfers"]),
            },
        },
        "onboardingDone": True,
    }
    return plan


def _resolve_refunds(legacy: dict, wanted: list, plan: Plan) -> set:
    """Ids completos de las transferencias indicadas (acepta prefijos únicos de 6+ caracteres)."""
    ids = [t["id"] for t in legacy.get("transfers", [])]
    out = set()
    for w in wanted:
        w = w.strip()
        if not w:
            continue
        matches = [i for i in ids if i == w] or ([i for i in ids if i.startswith(w)] if len(w) >= 6 else [])
        if len(matches) != 1:
            plan.error("bad_refund_id", f"--refund-transfers: '{w}' coincide con {len(matches)} transferencias "
                       "(usa el id que muestra el comando own-expenses).")
            continue
        t = next(t for t in legacy["transfers"] if t["id"] == matches[0])
        if t.get("is_loan"):
            plan.error("bad_refund_id", f"--refund-transfers: {matches[0]} es un préstamo, no un reembolso.")
            continue
        out.add(matches[0])
    return out
