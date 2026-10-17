"""Firestore en memoria con la API mínima que usa el script (para tests)."""
from __future__ import annotations

import copy
from datetime import datetime, timezone


def _firestore_roundtrip(value):
    """Lo que Firestore hace al guardar y leer: datetimes sin zona -> UTC."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, dict):
        return {k: _firestore_roundtrip(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_firestore_roundtrip(v) for v in value]
    return value


class ReadOnlyViolation(AssertionError):
    pass


class FakeClient:
    def __init__(self, docs: dict | None = None, read_only: bool = False):
        self.docs: dict = {}              # "col/id/sub/id" -> dict
        self.read_only = read_only
        self.writes = 0
        for path, data in (docs or {}).items():
            self.docs[path] = _firestore_roundtrip(copy.deepcopy(data))

    # ----- API
    def collections(self):
        names = sorted({p.split("/")[0] for p in self.docs})
        return [FakeCollection(self, n) for n in names]

    def collection(self, path):
        return FakeCollection(self, path)

    def document(self, path):
        return FakeDocRef(self, path)

    def batch(self):
        return FakeBatch(self)

    # ----- internos
    def _write(self, path, data, merge=False):
        if self.read_only:
            raise ReadOnlyViolation(f"escritura en origen: {path}")
        self.writes += 1
        data = _firestore_roundtrip(copy.deepcopy(data))
        if merge and path in self.docs:
            self.docs[path] = {**self.docs[path], **data}
        else:
            self.docs[path] = data

    def _delete(self, path):
        if self.read_only:
            raise ReadOnlyViolation(f"borrado en origen: {path}")
        self.writes += 1
        self.docs.pop(path, None)


class FakeSnap:
    def __init__(self, client, path):
        self._client, self._path = client, path
        self.id = path.split("/")[-1]
        self.exists = path in client.docs
        self.reference = FakeDocRef(client, path)

    def to_dict(self):
        return copy.deepcopy(self._client.docs.get(self._path)) if self.exists else None


class FakeCollection:
    def __init__(self, client, path):
        self._client, self.path = client, path
        self.id = path.split("/")[-1]

    def stream(self):
        depth = self.path.count("/") + 2
        paths = sorted(p for p in self._client.docs
                       if p.startswith(self.path + "/") and p.count("/") + 1 == depth)
        return [FakeSnap(self._client, p) for p in paths]


class FakeDocRef:
    def __init__(self, client, path):
        self._client, self.path = client, path
        self.id = path.split("/")[-1]

    def get(self):
        return FakeSnap(self._client, self.path)

    def set(self, data, merge=False):
        self._client._write(self.path, data, merge)

    def delete(self):
        self._client._delete(self.path)

    def collections(self):
        prefix = self.path + "/"
        names = sorted({p[len(prefix):].split("/")[0] for p in self._client.docs if p.startswith(prefix)})
        return [FakeCollection(self._client, prefix + n) for n in names]


class FakeBatch:
    def __init__(self, client):
        self._client, self._ops = client, []

    def set(self, ref, data, merge=False):
        self._ops.append(("set", ref.path, data, merge))

    def delete(self, ref):
        self._ops.append(("delete", ref.path, None, False))

    def commit(self):
        for kind, path, data, merge in self._ops:
            if kind == "set":
                self._client._write(path, data, merge)
            else:
                self._client._delete(path)


def legacy_to_docs(legacy: dict) -> dict:
    """{colección: [docs con id]} -> {"colección/id": campos} para sembrar un FakeClient."""
    return {f"{c}/{d['id']}": {k: v for k, v in d.items() if k != "id"}
            for c, docs in legacy.items() for d in docs}
