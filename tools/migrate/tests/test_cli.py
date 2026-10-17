"""
Flujo completo del CLI contra dos Firestore falsas en memoria:
backup, dry-run sin escrituras, migración, verificación, idempotencia,
documentos editados en la app nueva, prune y wipe. El origen es de solo
lectura: cualquier intento de escritura hace fallar el test.
"""
import json
from pathlib import Path

import pytest

from salary_migrate.synthetic import dataset
from fakefs import FakeClient, legacy_to_docs
from salary_migrate import cli
from salary_migrate.source import read_backup

UID = "uidTEST"


@pytest.fixture
def env(tmp_path, monkeypatch, legacy_path):
    L = dataset(42)
    src = FakeClient(legacy_to_docs(L), read_only=True)
    tgt = FakeClient()
    clients = {"old.json": src, "new.json": tgt}
    projects = {"old.json": "salary-old", "new.json": "salary2-ee33e"}
    monkeypatch.setattr(cli, "CLIENT_FACTORY", lambda key, db="(default)": clients[key])
    monkeypatch.setattr(cli, "PROJECT_ID", lambda key: projects[key])
    base = ["--backup-dir", str(tmp_path / "backups"), "--reports-dir", str(tmp_path / "reports")]
    engine = ["--engine-path", legacy_path] if (Path(legacy_path) / "services").exists() else []
    mig = ["migrate", "--source-key", "old.json", "--target-key", "new.json", "--uid", UID,
           "--min-month", "2026-02", "--current-month", "2026-06", *base, *engine]
    return {"L": L, "src": src, "tgt": tgt, "tmp": tmp_path, "base": base, "mig": mig,
            "projects": projects, "clients": clients, "engine": engine}


def user_docs(tgt):
    return {p: d for p, d in tgt.docs.items() if p.startswith(f"users/{UID}/") and "/meta/" not in p}


def test_inventory_reads_only_and_writes_backup(env):
    assert cli.main(["inventory", "--source-key", "old.json", *env["base"]]) == 0
    assert env["src"].writes == 0
    backups = list((env["tmp"] / "backups").glob("backup-*.json"))
    assert len(backups) == 1
    legacy, meta = read_backup(backups[0])
    assert legacy == {k: v for k, v in env["L"].items() if v}   # mismas colecciones no vacías, mismos datos
    reports = list((env["tmp"] / "reports").glob("inventory-*.json"))
    assert json.loads(reports[0].read_text())["migratable"] is True


def test_dry_run_writes_nothing(env):
    assert cli.main([*env["mig"], "--dry-run"]) == 0
    assert env["tgt"].writes == 0 and env["src"].writes == 0
    assert list((env["tmp"] / "backups").glob("backup-*.json"))   # pero sí hace backup


def test_migrate_verifies_and_is_idempotent(env):
    assert cli.main(env["mig"]) == 0
    first = user_docs(env["tgt"])
    n_writes = env["tgt"].writes
    assert len(first) > 50
    meta = env["tgt"].docs[f"users/{UID}/meta/migration"]
    assert meta["verified"] is True and meta["backupSha256"]
    profile = env["tgt"].docs[f"users/{UID}"]
    assert profile["settings"]["mainAccountId"] == next(a["id"] for a in env["L"]["accounts"] if a["is_main"])

    assert cli.main(env["mig"]) == 0                     # segunda vez
    assert user_docs(env["tgt"]) == first                # nada duplicado ni cambiado
    # solo se reescribe meta/migration (+ su actualización de verificación)
    assert env["tgt"].writes - n_writes == 2
    assert env["src"].writes == 0


def test_documents_edited_in_new_app_are_not_overwritten(env):
    assert cli.main(env["mig"]) == 0
    path = next(p for p in user_docs(env["tgt"]) if "/movements/" in p)
    env["tgt"].docs[path]["amount"] = 999.99              # edición en la app nueva
    edited = dict(env["tgt"].docs[path])
    rc = cli.main(env["mig"])
    assert env["tgt"].docs[path] == edited               # no se ha tocado
    assert rc == 1                                       # y la verificación lo señala: ya no es igual al origen


def test_edited_document_makes_verification_fail(env):
    assert cli.main(env["mig"]) == 0
    path = next(p for p in user_docs(env["tgt"]) if "/movements/" in p)
    env["tgt"].docs[path]["amount"] += 0.01
    rc = cli.main(["verify", "--target-key", "new.json", "--uid", UID, "--min-month", "2026-02",
                   "--current-month", "2026-06", "--backup",
                   str(sorted((env["tmp"] / "backups").glob("backup-*.json"))[-1]),
                   *env["base"], *env["engine"]])
    assert rc == 1


def test_overwrite_edited_restores(env):
    assert cli.main(env["mig"]) == 0
    path = next(p for p in user_docs(env["tgt"]) if "/movements/" in p)
    original = dict(env["tgt"].docs[path])
    env["tgt"].docs[path]["amount"] = 1.0
    assert cli.main([*env["mig"], "--overwrite-edited"]) == 0
    assert env["tgt"].docs[path] == original


def test_prune_only_with_flag(env):
    assert cli.main(env["mig"]) == 0
    gone = env["L"]["expenses"][0]["id"]
    env["src"].docs.pop(f"expenses/{gone}")              # se borró en la app vieja
    assert cli.main(env["mig"]) == 1                     # sin --prune se conserva... y la verificación lo señala
    assert f"users/{UID}/movements/{gone}" in env["tgt"].docs
    assert cli.main([*env["mig"], "--prune"]) == 0
    assert f"users/{UID}/movements/{gone}" not in env["tgt"].docs


def test_manual_documents_are_never_touched(env):
    assert cli.main(env["mig"]) == 0
    manual = f"users/{UID}/movements/manual1"
    env["tgt"].docs[manual] = {"type": "expense", "date": "2026-06-01", "amount": 5.0, "source": "manual"}
    assert cli.main([*env["mig"], "--prune", "--overwrite-edited"]) == 0
    assert env["tgt"].docs[manual]["amount"] == 5.0


def test_blocking_errors_write_nothing(env):
    other = next(a["id"] for a in env["L"]["accounts"] if not a["is_main"])
    env["src"].docs[f"accounts/{other}"]["is_main"] = True                       # 2 principales
    assert cli.main(env["mig"]) == 2
    assert env["tgt"].writes == 0


def test_same_project_is_refused(env, monkeypatch):
    env["projects"]["new.json"] = "salary-old"
    with pytest.raises(SystemExit):
        cli.main(env["mig"])
    assert env["tgt"].writes == 0


def test_bad_min_month_is_refused(env):
    with pytest.raises(SystemExit):
        cli.main([*[a if a != "2026-02" else "2026-2" for a in env["mig"]]])


def test_wipe_requires_confirmation_and_only_touches_uid(env):
    assert cli.main(env["mig"]) == 0
    env["tgt"].docs["users/otro/accounts/x"] = {"name": "ajena"}
    with pytest.raises(SystemExit):
        cli.main(["wipe", "--target-key", "new.json", "--uid", UID, "--confirm", "otro", *env["base"]])
    assert cli.main(["wipe", "--target-key", "new.json", "--uid", UID, "--confirm", UID, *env["base"]]) == 0
    assert not any(p.startswith(f"users/{UID}") for p in env["tgt"].docs)
    assert "users/otro/accounts/x" in env["tgt"].docs


def test_backup_is_tamper_evident(env):
    cli.main(["backup", "--source-key", "old.json", *env["base"]])
    b = next((env["tmp"] / "backups").glob("backup-*.json"))
    b.write_text(b.read_text().replace('"monto": ', '"monto": 1', 1))
    with pytest.raises(ValueError):
        read_backup(b)
