"""Inventario de solo lectura: qué hay en la base vieja y qué impediría migrarla."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime

from .serde import month_str
from .transform import KNOWN_FIELDS, LEGACY_COLLECTIONS, transform

DATE_FIELDS = ("fecha", "fecha_inicio")


def _type_name(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, datetime):
        return "timestamp"
    if isinstance(v, date):
        return "date"
    return type(v).__name__


def inventory(legacy: dict, min_month: str) -> dict:
    report = {"collections": {}, "unexpected_collections": []}
    for name, docs in sorted(legacy.items()):
        if name not in LEGACY_COLLECTIONS:
            report["unexpected_collections"].append({"name": name, "count": len(docs)})
        fields: dict = defaultdict(Counter)
        months = []
        for d in docs:
            for k, v in d.items():
                if k != "id":
                    fields[k][_type_name(v)] += 1
            for k in DATE_FIELDS:
                if d.get(k):
                    try:
                        months.append(month_str(d[k]))
                    except (TypeError, ValueError):
                        pass
        known = KNOWN_FIELDS.get(name, set())
        report["collections"][name] = {
            "count": len(docs),
            "fields": {k: dict(c) for k, c in sorted(fields.items())},
            "unknown_fields": sorted(k for k in fields if known and k not in known),
            "months": [min(months), max(months)] if months else None,
        }

    all_months = [c["months"][0] for c in report["collections"].values() if c["months"]]
    report["first_data_month"] = min(all_months) if all_months else None

    mains = [a["id"] for a in legacy.get("accounts", []) if a.get("is_main")]
    report["main_accounts"] = mains

    # Ensayo completo de la transformación (en memoria, no escribe nada).
    plan = transform(legacy, "inventory-dry-run", min_month)
    report["errors"] = plan.errors
    report["warnings"] = plan.warnings
    report["migratable"] = plan.ok
    return report
