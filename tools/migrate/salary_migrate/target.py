"""
Escritura en la Firestore NUEVA bajo users/{uid}/... de forma idempotente.

Cada documento migrado lleva `_migration.hash` = sha256 de su contenido.
Al volver a ejecutar:
  * no existe                       -> create
  * existe, mismo hash planificado  -> unchanged (no se escribe)
  * existe, su contenido coincide
    con su hash pero el plan cambió -> update (el origen cambió)
  * existe y su contenido NO
    coincide con su hash            -> conflict: lo editaste en la app nueva;
                                       no se toca salvo --overwrite-edited
Documentos migrados que ya no existen en el origen -> prune (solo con --prune).
Los documentos creados en la app nueva (sin _migration) nunca se tocan.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .serde import content_hash
from .transform import TARGET_COLLECTIONS, Plan

BATCH = 400


def _strip(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_migration"}


@dataclass
class Diff:
    create: list = field(default_factory=list)      # (coll, id)
    update: list = field(default_factory=list)
    unchanged: list = field(default_factory=list)
    conflict: list = field(default_factory=list)
    prune: list = field(default_factory=list)
    profile: str = "unchanged"                      # create | unchanged | differs
    profile_notes: list = field(default_factory=list)

    def summary(self) -> dict:
        return {"create": len(self.create), "update": len(self.update), "unchanged": len(self.unchanged),
                "conflict": len(self.conflict), "prune": len(self.prune), "profile": self.profile}


class Target:
    def __init__(self, client, project_id: str, uid: str):
        self.client = client
        self.project_id = project_id
        self.uid = uid
        self.root = f"users/{uid}"

    # ----- lectura
    def read_profile(self) -> dict | None:
        snap = self.client.document(self.root).get()
        return snap.to_dict() if snap.exists else None

    def read_docs(self) -> dict:
        return {c: {d.id: d.to_dict() for d in self.client.collection(f"{self.root}/{c}").stream()}
                for c in TARGET_COLLECTIONS}

    # ----- plan
    def diff(self, plan: Plan, existing: dict, existing_profile: dict | None) -> Diff:
        d = Diff()
        for coll in TARGET_COLLECTIONS:
            have = existing.get(coll, {})
            for doc_id, doc in plan.docs[coll].items():
                new_hash = content_hash(doc)
                cur = have.get(doc_id)
                if cur is None:
                    d.create.append((coll, doc_id))
                    continue
                stored = (cur.get("_migration") or {}).get("hash")
                if stored is None or content_hash(_strip(cur)) != stored:
                    d.conflict.append((coll, doc_id))
                elif stored == new_hash:
                    d.unchanged.append((coll, doc_id))
                else:
                    d.update.append((coll, doc_id))
            for doc_id, cur in have.items():
                if doc_id not in plan.docs[coll] and cur.get("_migration"):
                    d.prune.append((coll, doc_id))
        if existing_profile is None:
            d.profile = "create"
        else:
            cur_s = existing_profile.get("settings", {})
            new_s = plan.profile["settings"]
            for k in ("mainAccountId", "startMonth", "ownExpensesFrom"):
                if cur_s.get(k) != new_s.get(k):
                    d.profile = "differs"
                    d.profile_notes.append(f"settings.{k}: destino={cur_s.get(k)!r}, origen={new_s.get(k)!r}")
        return d

    # ----- escritura
    def apply(self, plan: Plan, diff: Diff, *, prune: bool, overwrite_edited: bool, meta: dict) -> dict:
        ops = []
        writes = diff.create + diff.update + (diff.conflict if overwrite_edited else [])
        for coll, doc_id in writes:
            doc = plan.docs[coll][doc_id]
            ops.append(("set", f"{self.root}/{coll}/{doc_id}", {**doc, "_migration": {"hash": content_hash(doc)}}))
        if prune:
            for coll, doc_id in diff.prune:
                ops.append(("delete", f"{self.root}/{coll}/{doc_id}", None))
        if diff.profile == "create":
            ops.append(("set", self.root, {**plan.profile, "createdAt": datetime.now(timezone.utc).isoformat()}))
        ops.append(("set", f"{self.root}/meta/migration", meta))
        for i in range(0, len(ops), BATCH):
            batch = self.client.batch()
            for kind, path, data in ops[i:i + BATCH]:
                ref = self.client.document(path)
                if kind == "set":
                    batch.set(ref, data)
                else:
                    batch.delete(ref)
            batch.commit()
        return {"written": len(writes), "pruned": len(diff.prune) if prune else 0,
                "profile_created": diff.profile == "create"}

    def update_meta(self, fields: dict):
        self.client.document(f"{self.root}/meta/migration").set(fields, merge=True)

    # ----- borrado completo (solo destino, solo un uid)
    def wipe(self) -> int:
        n = 0
        user_ref = self.client.document(self.root)
        for coll in user_ref.collections():
            for d in coll.stream():
                d.reference.delete()
                n += 1
        if user_ref.get().exists:
            user_ref.delete()
            n += 1
        return n
