"""
Verificación origen (backup de la Firestore vieja) vs destino (Firestore nueva).

Tres niveles, de más simple a más fuerte:
  1. Conteos por colección.
  2. Número de documentos y suma de importes por colección y mes.
     Se calcula del destino con los campos NUEVOS, por un camino de código
     independiente de la transformación.
  3. Motor de cálculo: se ejecuta el finance_core.py de la app vieja sobre el
     origen y sobre el destino (convertido de vuelta con reverse.to_legacy) y
     se comparan todas las cifras mes a mes. Es la prueba de "mismos resultados".
"""
from __future__ import annotations

import importlib
import sys
from collections import defaultdict
from pathlib import Path

from .reverse import to_legacy
from .serde import month_str
from .transform import add_months

TOLERANCE = 0.005  # igualdad al céntimo


# --------------------------------------------------------------------------- 1. conteos

def source_counts(legacy: dict) -> dict:
    fe_ids = {f["id"] for f in legacy.get("fixed_expenses", [])}
    sal_ids = {s["id"] for s in legacy.get("salaries", [])}
    accounts_with_cards = {e.get("account_id") for e in legacy.get("expenses", [])
                           if e.get("metodo_pago") == "credito"}
    accounts_with_cards |= {s.get("account_id") for s in legacy.get("credit_settlements", [])}
    return {
        "accounts": len(legacy.get("accounts", [])),
        "categories": len(legacy.get("categories", [])),
        "salaries": len(legacy.get("salaries", [])),
        "overtimes": sum(1 for o in legacy.get("overtimes", []) if o.get("salary_id") in sal_ids),
        "fixedExpenses": len(legacy.get("fixed_expenses", [])),
        "payments": sum(1 for i in legacy.get("fixed_expense_instances", []) if i.get("fixed_expense_id") in fe_ids),
        "budgets": len(legacy.get("budgets", [])),
        "movements.expense": len(legacy.get("expenses", [])),
        "movements.income": len(legacy.get("incomes", [])),
        "movements.transfer": len(legacy.get("transfers", [])),
        "cards": len({a for a in accounts_with_cards if a}),
        "cardSettlements": len(legacy.get("credit_settlements", [])),
    }


def target_counts(docs: dict) -> dict:
    movs = docs.get("movements", {}).values()
    return {
        "accounts": len(docs.get("accounts", {})),
        "categories": len(docs.get("categories", {})),
        "salaries": len(docs.get("salaries", {})),
        "overtimes": sum(len(s.get("overtimes", [])) for s in docs.get("salaries", {}).values()),
        "fixedExpenses": len(docs.get("fixedExpenses", {})),
        "payments": sum(len(f.get("payments", {})) for f in docs.get("fixedExpenses", {}).values()),
        "budgets": len(docs.get("budgets", {})),
        "movements.expense": sum(1 for m in movs if m.get("type") == "expense"),
        "movements.income": sum(1 for m in movs if m.get("type") == "income"),
        "movements.transfer": sum(1 for m in movs if m.get("type") == "transfer"),
        "cards": len(docs.get("cards", {})),
        "cardSettlements": len(docs.get("cardSettlements", {})),
    }


# --------------------------------------------------------------------------- 2. totales por mes

def _add(acc, bucket, month, amount):
    c, s = acc[(bucket, month)]
    acc[(bucket, month)] = (c + 1, s + (amount or 0.0))


def source_monthly(legacy: dict) -> dict:
    acc = defaultdict(lambda: (0, 0.0))
    fe_ids = {f["id"] for f in legacy.get("fixed_expenses", [])}
    sal_ids = {s["id"] for s in legacy.get("salaries", [])}
    for e in legacy.get("expenses", []):
        _add(acc, "expense.credit" if e.get("metodo_pago") == "credito" else "expense.cash",
             month_str(e["fecha"]), e["monto"])
    for i in legacy.get("incomes", []):
        _add(acc, "income", month_str(i["fecha"]), i["monto"])
    for t in legacy.get("transfers", []):
        _add(acc, "transfer.loan" if t.get("is_loan") else "transfer", month_str(t["fecha"]), t["monto"])
    for st in legacy.get("credit_settlements", []):
        _add(acc, "cardSettlement", month_str(st["fecha"]), st["monto"])
    for i in legacy.get("fixed_expense_instances", []):
        if i.get("fixed_expense_id") in fe_ids:
            _add(acc, f"fixedPayment.{i.get('estado')}", i.get("mes", ""), i.get("monto"))
    for o in legacy.get("overtimes", []):
        if o.get("salary_id") in sal_ids:
            _add(acc, "overtime", o.get("mes_aplicacion", ""), o.get("monto_bruto"))
    return dict(acc)


def target_monthly(docs: dict) -> dict:
    acc = defaultdict(lambda: (0, 0.0))
    for m in docs.get("movements", {}).values():
        month = m["date"][:7]
        if m["type"] == "expense":
            _add(acc, "expense.credit" if m.get("card") else "expense.cash", month, m["amount"])
        elif m["type"] == "income":
            _add(acc, "income", month, m["amount"])
        else:
            _add(acc, "transfer.loan" if m.get("transferKind") == "loan" else "transfer", month, m["amount"])
    for st in docs.get("cardSettlements", {}).values():
        _add(acc, "cardSettlement", st["date"][:7], st["amount"])
    for f in docs.get("fixedExpenses", {}).values():
        for mes, p in f.get("payments", {}).items():
            _add(acc, "fixedPayment." + ("pagado" if p["status"] == "paid" else "impagado"), mes, p.get("amount"))
    for s in docs.get("salaries", {}).values():
        for o in s.get("overtimes", []):
            _add(acc, "overtime", o["month"], o["gross"])
    return dict(acc)


# --------------------------------------------------------------------------- 3. motor viejo

def load_engine(engine_path: str):
    """Importa services.finance_core del repo viejo (solo lectura, solo cálculo)."""
    p = str(Path(engine_path).resolve())
    if p not in sys.path:
        sys.path.insert(0, p)
    return importlib.import_module("services.finance_core").FinanceCore


def _months(core, min_month: str, current: str, ahead: int = 12) -> list:
    first = core.first_data_month() or current
    start = min(first, add_months(min_month, -1))
    out, m = [], start
    while m <= add_months(current, ahead):
        out.append(m)
        m = add_months(m, 1)
    return out


def engine_metrics(FinanceCore, data: dict, current: str, min_month: str, months: list) -> dict:
    """Todas las cifras que muestra la app vieja, como {clave: número}."""
    core = FinanceCore(data, current, min_month)
    out: dict = {}
    accounts = [a["id"] for a in data["accounts"]]
    main = next((a["id"] for a in data["accounts"] if a.get("is_main")), None)

    def put(key, value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[key] = float(value)

    for m in months:
        s = core.month_summary(m)
        for k, v in s.items():
            put(f"{m}|summary|{k}", v)
        if s.get("resultado_real_details"):
            put(f"{m}|summary|pending_loans_total",
                sum(l.get("outstanding_amount", l.get("monto", 0.0)) for l in s["resultado_real_details"]["pending_loans"]))
        carry = s.get("remaining_from_previous_month", 0.0)
        for a in accounts:
            put(f"{m}|{a}|real_balance", core.real_balance(a, m))
            pb = core.projected_balance(a, m)
            put(f"{m}|{a}|projected_balance", pb["resultado"])
            put(f"{m}|{a}|card_outstanding_reserved", core.credit_outstanding(a, m, True))
            put(f"{m}|{a}|card_outstanding_all", core.credit_outstanding(a, m, False))
            put(f"{m}|{a}|month_real", core.month_real_result(a, m))
            pr = core.month_projected_result(a, m, carry if a == main else 0.0)
            put(f"{m}|{a}|month_projected", pr["resultado"])
            put(f"{m}|{a}|month_projected_pre", pr["resultado_pre_absorcion"])
            put(f"{m}|{a}|card_debt_carried", pr["deuda_tarjeta_arrastrada"])
            for bd in pr["budget_details"]:
                for k in ("presupuesto", "real_spent", "available", "absorbed"):
                    put(f"{m}|{a}|budget|{bd['budget_id']}|{k}", bd[k])
            for cat, v in core.raw_category_expenses(m, a).items():
                put(f"{m}|{a}|raw_category|{cat}", v)
        if main:
            for acc_id, v in core.propio_expenses_by_account(m, main).items():
                put(f"{m}|propios|{acc_id}", v)
        by_tipo: dict = defaultdict(float)
        for o in core.pending_obligations(m):
            by_tipo[o["tipo"]] += o["monto"]
        for tipo, v in by_tipo.items():
            put(f"{m}|pending|{tipo}", v)
        for sal in data["salaries"]:
            for k, v in core.salary_breakdown(sal["id"], m).items():
                put(f"{m}|salary|{sal['id']}|{k}", v)
    for a in accounts:
        for k, v in core.pending_loans_impact(a).items():
            put(f"loans|{a}|{k}", v)
    for g in core.credit_groups():
        put(f"credit_group|{g['account_id']}|{g['mes_cargo']}|total", g["total"])
        put(f"credit_group|{g['account_id']}|{g['mes_cargo']}|settled", 1.0 if g["settlement"] else 0.0)
    return out


def compare_metrics(src: dict, tgt: dict) -> dict:
    keys = set(src) | set(tgt)
    mismatches, exact, max_diff = [], 0, 0.0
    for k in sorted(keys):
        a, b = src.get(k), tgt.get(k)
        if a is None or b is None:
            mismatches.append({"key": k, "source": a, "target": b})
            continue
        d = abs(a - b)
        max_diff = max(max_diff, d)
        if d == 0:
            exact += 1
        else:
            # Mismo motor, mismos datos, mismo orden: cualquier diferencia, aunque sea de
            # 1e-12, indica que algo no se migró igual. No se tolera.
            mismatches.append({"key": k, "source": a, "target": b, "diff": b - a})
    return {"compared": len(keys), "exact": exact, "max_abs_diff": max_diff, "mismatches": mismatches}


# --------------------------------------------------------------------------- informe

def verify(legacy: dict, profile: dict, docs: dict, *, engine_path: str | None,
           current_month: str, min_month: str) -> dict:
    report: dict = {"ok": True}

    sc, tc = source_counts(legacy), target_counts(docs)
    report["counts"] = {k: {"source": sc[k], "target": tc.get(k)} for k in sc}
    if any(sc[k] != tc.get(k) for k in sc):
        report["ok"] = False

    sm, tm = source_monthly(legacy), target_monthly(docs)
    monthly_diff = []
    for key in sorted(set(sm) | set(tm)):
        a, b = sm.get(key, (0, 0.0)), tm.get(key, (0, 0.0))
        if a[0] != b[0] or abs(a[1] - b[1]) > TOLERANCE:
            monthly_diff.append({"bucket": key[0], "month": key[1], "source": a, "target": b})
    report["monthly"] = {"buckets": len(set(sm) | set(tm)), "differences": monthly_diff}
    if monthly_diff:
        report["ok"] = False

    if engine_path:
        FinanceCore = load_engine(engine_path)
        tgt_legacy = to_legacy(profile, docs)
        months = _months(FinanceCore(legacy, current_month, min_month), min_month, current_month)
        src_m = engine_metrics(FinanceCore, legacy, current_month, min_month, months)
        # El destino se calcula con SU propio startMonth: si se guardó mal, salta aquí.
        tgt_min = profile.get("settings", {}).get("startMonth") or "missing"
        tgt_m = engine_metrics(FinanceCore, tgt_legacy, current_month, tgt_min, months)
        cmp = compare_metrics(src_m, tgt_m)
        cmp["months"] = [months[0], months[-1]] if months else []
        report["engine"] = cmp
        if cmp["mismatches"]:
            report["ok"] = False
    else:
        report["engine"] = None
    return report


def history_invariant(profile: dict, base: dict, hist: dict, *, engine_path: str, current_month: str,
                      min_month: str, until: str) -> dict:
    """El histórico vive en cuentas archivadas propias: con o sin él, toda cifra de las cuentas
    reales y todo resumen desde el primer mes de la app tiene que ser idéntico."""
    FinanceCore = load_engine(engine_path)
    merged = {c: {**base.get(c, {}), **hist.get(c, {})} for c in set(base) | set(hist)}
    a, b = to_legacy(profile, base), to_legacy(profile, merged)
    start = profile.get("settings", {}).get("startMonth") or min_month
    months = _months(FinanceCore(a, current_month, start), start, current_month)
    ma = engine_metrics(FinanceCore, a, current_month, start, months)
    mb = engine_metrics(FinanceCore, b, current_month, start, months)
    hist_accounts = set(hist.get("accounts", {}))
    mismatches, compared = [], 0
    for k, v in ma.items():
        month = k.split("|", 1)[0]
        # Los resúmenes de los meses del histórico cambian por definición (suman sus gastos).
        if "|summary|" in k and month <= until:
            continue
        compared += 1
        w = mb.get(k)
        if w is None or abs(v - w) > TOLERANCE:
            mismatches.append(f"{k}: sin histórico {v} · con histórico {w}")
    extra = [k for k in mb if k not in ma and not any(f"|{h}|" in k for h in hist_accounts)
             and not (("|summary|" in k or "|pending|" in k) and k.split("|", 1)[0] <= until)]
    mismatches += [f"{k}: aparece solo con el histórico" for k in extra]
    return {"compared": compared, "mismatches": mismatches}
