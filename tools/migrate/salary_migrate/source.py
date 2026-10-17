"""
Lectura de la Firestore VIEJA y backup.

Garantías de solo lectura (dos capas):
  1. Recomendado: la service account del proyecto viejo solo tiene el rol
     "Cloud Datastore Viewer" (roles/datastore.viewer). Firestore rechaza
     cualquier escritura aunque el código fallara.
  2. ReadOnlySource solo expone listar colecciones y leer documentos. El cliente
     real nunca sale de esta clase, así que ninguna función del script puede
     escribir en el origen por error.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .serde import decode, encode


class ReadOnlySource:
    def __init__(self, client, project_id: str):
        self.__client = client          # privado: no se expone a nadie
        self.project_id = project_id

    def snapshot(self) -> dict:
        """Todas las colecciones raíz, cada una como lista de dicts ordenada por id."""
        out = {}
        for coll in sorted(self.__client.collections(), key=lambda c: c.id):
            docs = [{"id": d.id, **(d.to_dict() or {})} for d in coll.stream()]
            out[coll.id] = sorted(docs, key=lambda d: d["id"])
        return out


def write_backup(collections: dict, project_id: str, backup_dir: Path) -> tuple[Path, str]:
    """Guarda el JSON y su sha256 al lado. Devuelve (ruta, sha256)."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = backup_dir / f"backup-{project_id}-{stamp}.json"
    payload = {
        "format": "salary-legacy-backup/1",
        "sourceProject": project_id,
        "takenAt": datetime.now(timezone.utc).isoformat(),
        "counts": {k: len(v) for k, v in collections.items()},
        "collections": encode(collections),
    }
    data = json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8")
    path.write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    (path.parent / (path.name + ".sha256")).write_text(f"{sha}  {path.name}\n")
    return path, sha


def read_backup(path: Path) -> tuple[dict, dict]:
    """Devuelve (colecciones decodificadas, metadatos). Comprueba el sha256 si existe."""
    raw = path.read_bytes()
    sha_file = path.parent / (path.name + ".sha256")
    sha = hashlib.sha256(raw).hexdigest()
    if sha_file.exists():
        expected = sha_file.read_text().split()[0]
        if expected != sha:
            raise ValueError(f"El backup {path.name} no coincide con su sha256: está alterado o incompleto.")
    payload = json.loads(raw)
    meta = {k: v for k, v in payload.items() if k != "collections"}
    meta["sha256"] = sha
    meta["file"] = str(path)
    return decode(payload["collections"]), meta
