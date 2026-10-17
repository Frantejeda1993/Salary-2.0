"""
Fase 3 — Valores de referencia.

Ejecuta el motor de cálculo de la app vieja (services/finance_core.py) y guarda
todas las cifras que produce, para varios "meses actuales", junto con el dataset
en el MODELO NUEVO. La Fase 4 (motor TypeScript) debe reproducir esas cifras a
partir de ese dataset.

Tres tipos de fichero, mismo formato (ver fixtures/reference/README.md):
  real        tus datos tal cual            -> SOLO fuera del repo
  anonymized  tus datos anonimizados        -> fuera del repo salvo decisión expresa
  synthetic   datos inventados (tests/datasets.py) -> en el repo

Las cifras esperadas se calculan SIEMPRE sobre los datos viejos originales
(la verdad es la app vieja) y se comprueba que el dataset en modelo nuevo,
convertido de vuelta, da exactamente lo mismo. Si no, el fichero no se escribe.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .reverse import to_legacy
from .serde import UTC, as_date, encode, to_utc
from .transform import AUTO_TRANSFER_DESCRIPTION, LEGACY_COLLECTIONS, add_months, transform
from .verify import _months, compare_metrics, engine_metrics

FORMAT = "salary-reference/1"


# --------------------------------------------------------------------------- dataset en modelo nuevo

def _clean_doc(doc: dict) -> dict:
    """Quita lo que el motor no necesita (trazas, fechas de creación). Conserva
    legacy.id y payments[].legacyId: fijan el orden de suma del motor viejo."""
    out = {k: v for k, v in doc.items() if k not in ("legacy", "createdAt", "source", "_migration")}
    legacy_id = (doc.get("legacy") or {}).get("id")
    if legacy_id:
        out["legacy"] = {"id": legacy_id}
    if "payments" in out:
        out["payments"] = {m: {k: v for k, v in p.items() if k in ("status", "amount", "legacyId")}
                           for m, p in out["payments"].items()}
    if "overtimes" in out:
        out["overtimes"] = [{k: v for k, v in o.items() if k in ("id", "month", "gross")} for o in out["overtimes"]]
    return out


def dataset_from_legacy(legacy: dict, start_month: str, **kw) -> tuple[dict, list]:
    plan = transform(legacy, "reference", start_month, **kw)
    if not plan.ok:
        raise ValueError(f"Datos no migrables: {plan.errors[:3]}")
    docs = {c: {i: _clean_doc(d) for i, d in sorted(v.items())} for c, v in plan.docs.items()}
    profile = {"settings": {k: plan.profile["settings"][k] for k in ("startMonth", "mainAccountId", "ownExpensesFrom")
                            if k in plan.profile["settings"]}}
    return {"profile": profile, "docs": docs}, plan.warnings


# --------------------------------------------------------------------------- casos

def build_cases(FinanceCore, legacy: dict, dataset: dict, start_month: str, current_months: list) -> list:
    back = to_legacy(dataset["profile"], dataset["docs"])
    cases = []
    for current in current_months:
        months = _months(FinanceCore(legacy, current, start_month), start_month, current)
        expected = engine_metrics(FinanceCore, legacy, current, start_month, months)
        roundtrip = engine_metrics(FinanceCore, back, current, start_month, months)
        cmp = compare_metrics(expected, roundtrip)
        if cmp["mismatches"]:
            raise AssertionError(f"El dataset nuevo no reproduce el motor viejo en {current}: "
                                 f"{cmp['mismatches'][:3]}")
        cases.append({"currentMonth": current, "startMonth": start_month,
                      "months": [months[0], months[-1]], "metrics": dict(sorted(expected.items()))})
    return cases


def coverage(legacy: dict, cases: list) -> dict:
    """Qué escenarios contiene el fichero: sin esto, 'todos los tests pasan' no dice nada."""
    exp = legacy.get("expenses", [])
    c = Counter()
    eps = 0.005  # por debajo del céntimo es ruido de coma flotante (p. ej. atrasos de 9e-13), no un escenario
    for case in cases:
        cur = case["currentMonth"]
        for k, v in case["metrics"].items():
            parts = k.split("|")
            if len(parts) >= 5 and parts[2] == "budget":
                if parts[4] == "absorbed" and v > eps:
                    c["budget_absorbs_deficit"] += 1
                if parts[4] == "available" and v < -eps:
                    c["budget_exceeded"] += 1
            elif len(parts) == 3 and parts[1] == "summary":
                if parts[2] == "remaining_from_previous_month" and abs(v) > eps:
                    c["carry_nonzero_closed" if parts[0] <= cur else "carry_nonzero_future"] += 1
                if parts[2] == "resultado_proyectado_pre_absorcion" and v < -eps:
                    c["projected_pre_negative"] += 1
                if parts[2] == "deuda_tarjeta_arrastrada" and v > eps:
                    c["card_debt_carried"] += 1
            elif len(parts) == 3 and parts[1] == "propios" and v > eps:
                c["own_expenses_pending"] += 1
            elif len(parts) >= 4 and parts[1] == "salary" and parts[3] == "atrasos" and abs(v) > eps:
                c["salary_arrears"] += 1
    return {
        "per_case_totals": dict(sorted(c.items())),
        "data": {
            "expenses": len(exp),
            "credit_purchases": sum(1 for e in exp if e.get("metodo_pago") == "credito"),
            "credit_reserved_in_charge_month": sum(1 for e in exp if e.get("metodo_pago") == "credito"
                                                   and e.get("reservar_en") == "cargo"),
            "credit_settlements": len(legacy.get("credit_settlements", [])),
            "budgets": len(legacy.get("budgets", [])),
            "fixed_expenses": len(legacy.get("fixed_expenses", [])),
            "own_fixed_expenses": sum(1 for f in legacy.get("fixed_expenses", []) if f.get("es_propio")),
            "fixed_paid": sum(1 for i in legacy.get("fixed_expense_instances", []) if i.get("estado") == "pagado"),
            "loans": sum(1 for t in legacy.get("transfers", []) if t.get("is_loan")),
            "auto_refunds": sum(1 for t in legacy.get("transfers", [])
                                if t.get("descripcion") == AUTO_TRANSFER_DESCRIPTION),
            "salary_revisions": sum(len(s.get("revisiones") or []) for s in legacy.get("salaries", [])),
            "overtimes": len(legacy.get("overtimes", [])),
        },
        "cases": len(cases),
        "metrics": sum(len(c["metrics"]) for c in cases),
    }


def make_reference(FinanceCore, legacy: dict, kind: str, start_month: str, current_months: list,
                   source: dict | None = None, own_expenses_from: str | None = None,
                   refund_transfers: list | None = None) -> dict:
    dataset, warnings = dataset_from_legacy(legacy, start_month, own_expenses_from=own_expenses_from,
                                            refund_transfers=refund_transfers or [])
    cases = build_cases(FinanceCore, legacy, dataset, start_month, current_months)
    return {
        "format": FORMAT,
        "kind": kind,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": source or {},
        "dataset": dataset,
        "cases": cases,
        "coverage": coverage(legacy, cases),
        "migrationWarnings": [w["code"] for w in warnings],
    }


def write_reference(ref: dict, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # json usa repr() para los float: la representación más corta que vuelve al mismo
    # double. JSON.parse en JavaScript reconstruye exactamente el mismo número.
    path.write_text(json.dumps(encode(ref), ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def months_between(a: str, b: str) -> list:
    out, m = [], a
    while m <= b:
        out.append(m)
        m = add_months(m, 1)
    return out


# --------------------------------------------------------------------------- anonimización

PREFIX = {"accounts": "acc", "banks": "bnk", "categories": "cat", "salaries": "sal", "overtimes": "ot",
          "expenses": "exp", "incomes": "inc", "transfers": "trf", "budgets": "bud",
          "fixed_expenses": "fix", "fixed_expense_instances": "fxi", "credit_settlements": "stl",
          "monthly_account_snapshots": "snp"}

REF_FIELDS = {  # campo -> colección a la que apunta
    "bank_id": "banks", "account_id": "accounts", "categoria_id": "categories", "salary_id": "salaries",
    "fixed_expense_id": "fixed_expenses", "cuenta_origen": "accounts", "cuenta_destino": "accounts",
}

AMOUNT_FIELDS = {"monto", "saldo_inicial", "salario_bruto", "monto_bruto", "outstanding_amount"}

KEEP_FIELDS = {  # todo lo demás se elimina (textos libres, campos desconocidos)
    "accounts": {"bank_id", "saldo_inicial", "is_main"},
    "banks": set(),
    "categories": {"tipo"},
    "salaries": {"salario_bruto", "fecha_inicio", "fecha_fin", "account_id", "deductions", "revisiones",
                 "cont_comun", "cont_comun_aplica_extras", "mei", "mei_aplica_extras", "formacion",
                 "formacion_aplica_extras", "desempleo", "desempleo_aplica_extras", "irpf", "irpf_aplica_extras"},
    "overtimes": {"salary_id", "monto_bruto", "mes_aplicacion"},
    "expenses": {"fecha", "monto", "categoria_id", "account_id", "metodo_pago", "mes_cargo", "reservar_en",
                 "fuel_expense", "km_done", "price_per_l"},
    "incomes": {"fecha", "monto", "categoria_id", "account_id"},
    "transfers": {"fecha", "cuenta_origen", "cuenta_destino", "monto", "is_loan", "status",
                  "outstanding_amount", "descripcion"},
    "budgets": {"categoria_id", "monto", "fecha_inicio", "fecha_fin", "account_id"},
    "fixed_expenses": {"monto", "fecha_inicio", "fecha_fin", "account_id", "es_propio", "revisiones"},
    "fixed_expense_instances": {"fixed_expense_id", "mes", "estado", "monto"},
    "credit_settlements": {"account_id", "mes_cargo", "fecha", "monto"},
    "monthly_account_snapshots": set(),
}


def anonymize(legacy: dict, seed: int | None = None) -> dict:
    """
    Copia anonimizada que conserva todo lo que el motor distingue:
      * ids nuevos (acc0001, exp0042…) que mantienen el MISMO orden que los originales
        (el orden fija el reparto de la absorción y el orden de las sumas);
      * meses intactos; el día dentro del mes, aleatorio (el motor solo usa el mes);
      * todos los importes multiplicados por un único factor aleatorio entre 0,7 y 1,3
        y redondeados al céntimo: se conservan las relaciones (budget superado o no,
        déficit o no) salvo empates exactos; el factor no se guarda;
      * nombres, descripciones, propietarios y campos desconocidos, eliminados;
        se conserva solo la descripción especial del reembolso automático (tiene efecto).
    """
    rnd = random.Random(seed) if seed is not None else random.SystemRandom()
    k = rnd.uniform(0.7, 1.3)
    idmap: dict = {}
    for coll in LEGACY_COLLECTIONS:
        for i, d in enumerate(sorted(legacy.get(coll, []), key=lambda d: d["id"]), start=1):
            idmap[(coll, d["id"])] = f"{PREFIX[coll]}{i:04d}"
    missing: dict = {}

    def ref(coll, value):
        if value in (None, ""):
            return value
        if (coll, value) in idmap:
            return idmap[(coll, value)]
        missing.setdefault((coll, value), f"zzmissing{len(missing) + 1:03d}")
        return missing[(coll, value)]

    def amount(v):
        return round(v * k, 2) if isinstance(v, (int, float)) and not isinstance(v, bool) else v

    def shuffle_day(v):
        if v in (None, ""):
            return v
        d = as_date(v)
        return datetime(d.year, d.month, rnd.randint(1, 28), tzinfo=UTC)

    out = {}
    for coll in LEGACY_COLLECTIONS:
        docs = []
        for d in sorted(legacy.get(coll, []), key=lambda d: d["id"]):
            n = {"id": idmap[(coll, d["id"])]}
            for f in KEEP_FIELDS[coll]:
                if f not in d:
                    continue
                v = d[f]
                if f in REF_FIELDS:
                    v = ref(REF_FIELDS[f], v)
                elif f in AMOUNT_FIELDS:
                    v = amount(v)
                elif f == "fecha":
                    v = shuffle_day(v)
                elif f in ("fecha_inicio", "fecha_fin") and v:
                    v = to_utc(v) if isinstance(v, datetime) else v  # inicio/fin: el día no se usa, se deja
                elif f == "descripcion":
                    v = AUTO_TRANSFER_DESCRIPTION if v == AUTO_TRANSFER_DESCRIPTION else ""
                elif f == "revisiones":
                    v = [{**r, **({"salario_bruto": amount(r["salario_bruto"])} if "salario_bruto" in r else {}),
                          **({"monto": amount(r["monto"])} if r.get("monto") is not None else {}),
                          **({"account_id": ref("accounts", r["account_id"])} if r.get("account_id") else {}),
                          **({"bank_id": ref("banks", r["bank_id"])} if r.get("bank_id") else {})}
                         for r in v]
                elif f == "deductions":
                    v = [{"name": f"D{j}" if dd.get("name") else dd.get("name"),
                          **{kk: vv for kk, vv in dd.items() if kk != "name"}} for j, dd in enumerate(v, 1)]
                n[f] = v
            if coll in ("accounts", "categories", "salaries", "fixed_expenses", "expenses", "incomes", "banks"):
                n["nombre"] = n["id"]
            docs.append(n)
        out[coll] = docs
    return out


def assert_no_text_leak(original: dict, anon_json: str):
    """Ningún texto libre del original (nombres, descripciones, ids) aparece en la copia."""
    leaks = set()
    for coll, docs in original.items():
        for d in docs:
            if len(d["id"]) >= 8 and d["id"] in anon_json:
                leaks.add(d["id"])
            for f in ("nombre", "duenio", "descripcion"):
                v = d.get(f)
                if isinstance(v, str) and len(v) >= 4 and v != AUTO_TRANSFER_DESCRIPTION and f'"{v}"' in anon_json:
                    leaks.add(v)
    if leaks:
        raise AssertionError(f"La anonimización deja pasar {len(leaks)} texto(s) del original.")


def map_ids(original: dict, anonymized: dict, ids: list, coll: str) -> list:
    """Traduce ids (o prefijos) del original a los ids de la copia anonimizada (mismo orden)."""
    orig = sorted(d["id"] for d in original.get(coll, []))
    anon = sorted(d["id"] for d in anonymized.get(coll, []))
    out = []
    for w in ids:
        hits = [i for i, o in enumerate(orig) if o == w or (len(w) >= 6 and o.startswith(w))]
        if len(hits) == 1:
            out.append(anon[hits[0]])
    return out
