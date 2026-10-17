"""
Serialización del backup y utilidades de fechas.

El backup es JSON plano. Los tipos de Firestore que JSON no tiene se guardan
etiquetados para poder reconstruirlos exactamente:
    Timestamp -> {"__type": "timestamp", "value": "2026-03-01T00:00:00.000000+00:00"}
    bytes     -> {"__type": "bytes", "value": "<base64>"}
    otros     -> {"__type": "repr", "class": "...", "value": "..."}  (solo informativo)
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import date, datetime, timezone
from typing import Any

UTC = timezone.utc


# --------------------------------------------------------------------------- fechas

def to_utc(value: datetime) -> datetime:
    """Datetime con zona UTC. Un datetime sin zona se interpreta como UTC
    (es lo que hace el cliente de Firestore al guardarlo)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def as_date(value) -> date:
    """Misma semántica que finance_core.as_date de la app vieja, pero siempre
    en UTC: un Timestamp de Firestore llega con zona UTC y .date() devuelve el día UTC."""
    if isinstance(value, datetime):
        return to_utc(value).date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def date_str(value) -> str | None:
    """'YYYY-MM-DD' o None."""
    if value is None or value == "":
        return None
    return as_date(value).isoformat()


def month_str(value) -> str:
    return as_date(value).strftime("%Y-%m")


def is_midnight_utc(value) -> bool:
    if not isinstance(value, datetime):
        return True
    v = to_utc(value)
    return (v.hour, v.minute, v.second, v.microsecond) == (0, 0, 0, 0)


def iso_or_none(value) -> str | None:
    if isinstance(value, datetime):
        return to_utc(value).isoformat()
    if value is None:
        return None
    return str(value)


# --------------------------------------------------------------------------- backup JSON

def encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"__type": "timestamp", "value": to_utc(value).isoformat(timespec="microseconds")}
    if isinstance(value, date):
        return {"__type": "date", "value": value.isoformat()}
    if isinstance(value, bytes):
        return {"__type": "bytes", "value": base64.b64encode(value).decode()}
    if isinstance(value, dict):
        return {str(k): encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return {"__type": "repr", "class": type(value).__name__, "value": repr(value)}


def decode(value: Any) -> Any:
    if isinstance(value, dict):
        t = value.get("__type")
        if t == "timestamp":
            return datetime.fromisoformat(value["value"])
        if t == "date":
            return date.fromisoformat(value["value"])
        if t == "bytes":
            return base64.b64decode(value["value"])
        if t == "repr":
            return value  # se conserva tal cual; la transformación lo avisará
        return {k: decode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decode(v) for v in value]
    return value


def canonical_json(value: Any) -> str:
    """JSON estable (claves ordenadas) para hashes y comparaciones."""
    return json.dumps(encode(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
