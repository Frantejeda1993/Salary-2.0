"""
Migración Salary (Streamlit) -> Salary 2.0.

  python -m salary_migrate inventory --source-key ~/.salary-keys/old.json
  python -m salary_migrate backup    --source-key ~/.salary-keys/old.json
  python -m salary_migrate migrate   --source-key ... --target-key ... --uid UID --min-month 2026-02 --dry-run
  python -m salary_migrate migrate   --source-key ... --target-key ... --uid UID --min-month 2026-02
  python -m salary_migrate verify    --target-key ... --uid UID --backup backups/backup-....json
  python -m salary_migrate wipe      --target-key ... --uid UID --confirm UID
  python -m salary_migrate reference --engine-path ../salary-legacy
  python -m salary_migrate fixtures-synthetic --engine-path ../salary-legacy --out ../../fixtures/reference

Códigos de salida: 0 ok, 1 verificación fallida, 2 datos no migrables, 3 uso incorrecto.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import inventory as inv
from .serde import encode
from .source import ReadOnlySource, read_backup, write_backup
from .target import Target
from .transform import transform
from .verify import verify

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# Backups e informes contienen datos financieros reales: por defecto, FUERA del repo.
WORKDIR = Path.home() / "salary-migration"


# --------------------------------------------------------------------------- clientes

def _project_id(key_path: str) -> str:
    data = json.loads(Path(key_path).expanduser().read_text())
    if data.get("type") != "service_account":
        raise SystemExit(f"{key_path} no es una clave de service account.")
    return data["project_id"]


def make_client(key_path: str, database: str = "(default)"):
    from google.cloud import firestore
    from google.oauth2 import service_account
    path = Path(key_path).expanduser()
    creds = service_account.Credentials.from_service_account_file(str(path))
    return firestore.Client(credentials=creds, project=_project_id(str(path)), database=database)


# Puntos de inyección para los tests (sustituyen Firestore por una falsa).
CLIENT_FACTORY = make_client
PROJECT_ID = _project_id


def current_month_madrid() -> str:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("Europe/Madrid")).strftime("%Y-%m")


# --------------------------------------------------------------------------- utilidades

def _save_report(reports_dir: Path, name: str, data: dict) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    p = reports_dir / f"{name}-{stamp}.json"
    p.write_text(json.dumps(encode(data), ensure_ascii=False, indent=1, sort_keys=True))
    return p


def _print_issues(plan_like: dict, limit: int = 30):
    errors, warnings = plan_like.get("errors", []), plan_like.get("warnings", [])
    if errors:
        print(f"\n✖ {len(errors)} error(es) que impiden migrar:")
        for e in errors[:limit]:
            print(f"   - [{e['code']}] {e['message']}")
    if warnings:
        print(f"\n⚠ {len(warnings)} aviso(s):")
        by_code: dict = {}
        for w in warnings:
            by_code.setdefault(w["code"], []).append(w)
        for code, items in sorted(by_code.items()):
            print(f"   - [{code}] x{len(items)}: {items[0]['message']}")


def _read_source(args) -> tuple[dict, dict]:
    """Lee el origen y SIEMPRE guarda un backup antes de seguir.
    Con --from-backup se usa un backup existente y no se toca el origen."""
    if getattr(args, "from_backup", None):
        legacy, meta = read_backup(Path(args.from_backup))
        print(f"Usando backup existente {meta['file']} (sha256 {meta['sha256'][:12]}…)")
        return legacy, meta
    pid = PROJECT_ID(args.source_key)
    print(f"Leyendo la Firestore vieja ({pid}) en solo lectura…")
    src = ReadOnlySource(CLIENT_FACTORY(args.source_key), pid)
    collections = src.snapshot()
    path, sha = write_backup(collections, pid, Path(args.backup_dir))
    print(f"Backup: {path} ({sum(len(v) for v in collections.values())} documentos, sha256 {sha[:12]}…)")
    legacy, meta = read_backup(path)  # se migra desde el backup: misma foto que la guardada
    return legacy, meta


def _check_month(value: str, name: str):
    if not MONTH_RE.match(value or ""):
        raise SystemExit(f"{name} debe tener formato YYYY-MM (recibido {value!r}).")


# --------------------------------------------------------------------------- comandos

def cmd_inventory(args) -> int:
    legacy, meta = _read_source(args)
    report = inv.inventory(legacy, args.min_month)
    report["backup"] = meta
    print("\nColecciones:")
    for name, c in report["collections"].items():
        rng = f"  {c['months'][0]} → {c['months'][1]}" if c["months"] else ""
        unk = f"  campos desconocidos: {c['unknown_fields']}" if c["unknown_fields"] else ""
        print(f"   {name:<28}{c['count']:>6}{rng}{unk}")
    for u in report["unexpected_collections"]:
        print(f"   ⚠ colección no esperada: {u['name']} ({u['count']}) — está en el backup, no se migra")
    print(f"\nPrimer mes con datos: {report['first_data_month']}")
    print(f"Cuenta(s) principal(es): {report['main_accounts']}")
    _print_issues(report)
    p = _save_report(Path(args.reports_dir), "inventory", report)
    print(f"\nInforme completo: {p}")
    print("\nMIGRABLE" if report["migratable"] else "\nNO MIGRABLE todavía: resuelve los errores de arriba.")
    return 0 if report["migratable"] else 2


def cmd_backup(args) -> int:
    _read_source(args)
    return 0


def cmd_migrate(args) -> int:
    _check_month(args.min_month, "--min-month")
    tgt_pid = PROJECT_ID(args.target_key)
    if not args.from_backup:
        src_pid = PROJECT_ID(args.source_key)
        if src_pid == tgt_pid:
            raise SystemExit(f"Origen y destino son el mismo proyecto ({src_pid}). Abortado.")
    legacy, meta = _read_source(args)

    plan = transform(legacy, args.uid, args.min_month, timezone=args.timezone,
                     own_expenses_from=args.own_expenses_from, refund_transfers=_split(args.refund_transfers))
    _print_issues({"errors": plan.errors, "warnings": plan.warnings})
    if not plan.ok:
        _save_report(Path(args.reports_dir), "migrate-blocked", {"errors": plan.errors, "warnings": plan.warnings})
        print("\nNo se ha escrito nada.")
        return 2

    target = Target(CLIENT_FACTORY(args.target_key, args.target_database), tgt_pid, args.uid)
    print(f"\nDestino: proyecto {tgt_pid}, users/{args.uid}")
    existing, existing_profile = target.read_docs(), target.read_profile()
    diff = target.diff(plan, existing, existing_profile)
    s = diff.summary()
    print(f"Plan: crear {s['create']} · actualizar {s['update']} · sin cambios {s['unchanged']} · "
          f"editados en la app nueva {s['conflict']} · a eliminar {s['prune']} · perfil {s['profile']}")
    for n in diff.profile_notes:
        print(f"   ⚠ perfil: {n} (no se sobrescribe; cámbialo en la app si hace falta)")
    if diff.conflict and not args.overwrite_edited:
        print(f"   ⚠ {len(diff.conflict)} documento(s) editados en la app nueva NO se sobrescribirán "
              f"(--overwrite-edited para forzarlo). Ej.: {diff.conflict[:3]}")
    if diff.prune and not args.prune:
        print(f"   ⚠ {len(diff.prune)} documento(s) migrados antes ya no existen en el origen. "
              f"Se mantienen (--prune para borrarlos). Ej.: {diff.prune[:3]}")

    if args.dry_run:
        _save_report(Path(args.reports_dir), "migrate-dry-run",
                     {"diff": s, "conflict": diff.conflict, "prune": diff.prune, "warnings": plan.warnings})
        print("\nDRY-RUN: no se ha escrito nada.")
        return 0

    run_meta = {
        "sourceProject": meta.get("sourceProject"), "backupFile": Path(meta["file"]).name,
        "backupSha256": meta["sha256"], "runAt": datetime.now(timezone.utc).isoformat(),
        "minManagedMonth": args.min_month, "diff": s,
        "warnings": plan.warnings[:500], "warningCount": len(plan.warnings), "verified": None,
    }
    res = target.apply(plan, diff, prune=args.prune, overwrite_edited=args.overwrite_edited, meta=run_meta)
    print(f"Escritos {res['written']} documentos" + (f", eliminados {res['pruned']}" if res["pruned"] else ""))
    return _verify_and_report(args, target, legacy)


def _verify_and_report(args, target: Target, legacy: dict) -> int:
    current = args.current_month or current_month_madrid()
    print(f"\nVerificando (mes actual {current})…")
    docs, profile = target.read_docs(), target.read_profile() or {}
    # Solo se verifica lo migrado: lo creado en la app nueva no está en el origen.
    docs = {c: {i: d for i, d in v.items() if d.get("_migration")} for c, v in docs.items()}
    report = verify(legacy, profile, docs, engine_path=args.engine_path,
                    current_month=current, min_month=args.min_month)
    for k, v in report["counts"].items():
        mark = "✔" if v["source"] == v["target"] else "✖"
        print(f"   {mark} {k:<22} origen {v['source']:>6}   destino {v['target']:>6}")
    md = report["monthly"]
    print(f"   {'✔' if not md['differences'] else '✖'} totales por mes: {md['buckets']} grupos (colección×mes), "
          f"{len(md['differences'])} diferencias")
    if report["engine"]:
        e = report["engine"]
        print(f"   {'✔' if not e['mismatches'] else '✖'} motor viejo {e['months'][0]}…{e['months'][1]}: "
              f"{e['compared']} cifras, {e['exact']} idénticas, diferencia máx. {e['max_abs_diff']:.2e}")
        for m in e["mismatches"][:15]:
            print(f"       {m}")
    else:
        print("   · comparación con el motor viejo omitida (falta --engine-path)")
    p = _save_report(Path(args.reports_dir), "verify", report)
    target.update_meta({"verified": report["ok"], "verifiedAt": datetime.now(timezone.utc).isoformat(),
                        "verifyReport": p.name})
    print(f"\nInforme: {p}")
    print("\nVERIFICACIÓN OK" if report["ok"] else "\nVERIFICACIÓN FALLIDA")
    return 0 if report["ok"] else 1


def cmd_verify(args) -> int:
    _check_month(args.min_month, "--min-month")
    legacy, _ = read_backup(Path(args.backup))
    target = Target(CLIENT_FACTORY(args.target_key, args.target_database), PROJECT_ID(args.target_key), args.uid)
    return _verify_and_report(args, target, legacy)


def cmd_wipe(args) -> int:
    if args.confirm != args.uid:
        raise SystemExit("Para borrar, repite el uid exacto en --confirm.")
    target = Target(CLIENT_FACTORY(args.target_key, args.target_database), PROJECT_ID(args.target_key), args.uid)
    n = target.wipe()
    print(f"Eliminados {n} documentos de users/{args.uid} en {target.project_id}.")
    return 0


def _engine_source(engine_path: str) -> dict:
    import subprocess
    try:
        sha = subprocess.run(["git", "-C", engine_path, "rev-parse", "HEAD"], capture_output=True,
                             text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        sha = ""
    return {"engineRepo": "Frantejeda1993/Salary", "engineCommit": sha or None}


def _print_coverage(label: str, ref: dict):
    cov = ref["coverage"]
    print(f"\n{label}: {cov['cases']} casos, {cov['metrics']} cifras")
    print("   datos:     " + ", ".join(f"{k}={v}" for k, v in cov["data"].items()))
    print("   escenarios:" + ("".join(f" {k}={v}" for k, v in cov["per_case_totals"].items()) or " ninguno"))


def cmd_reference(args) -> int:
    from . import reference as rf
    from .verify import load_engine
    _check_month(args.start_month, "--start-month")
    legacy, meta = read_backup(_latest_backup(args))
    print(f"Backup: {meta['file']} (sha256 {meta['sha256'][:12]}…)")
    FinanceCore = load_engine(args.engine_path)
    first = FinanceCore(legacy, args.start_month, args.start_month).first_data_month() or args.start_month
    currents = rf.months_between(args.current_from or first, args.current_to or current_month_madrid())
    print(f"Meses actuales: {currents[0]} … {currents[-1]} ({len(currents)})")
    src = {**_engine_source(args.engine_path), "backupSha256": meta["sha256"]}

    out = Path(args.out)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    extra = {"own_expenses_from": args.own_expenses_from, "refund_transfers": _split(args.refund_transfers)}
    real = rf.make_reference(FinanceCore, legacy, "real", args.start_month, currents, src, **extra)
    rf.write_reference(real, out / f"real-{stamp}.json")
    _print_coverage("REAL (tus datos, no salen de tu ordenador)", real)

    anon_legacy = rf.anonymize(legacy)
    anon = rf.make_reference(FinanceCore, anon_legacy, "anonymized", args.start_month, currents,
                             {"engineCommit": src["engineCommit"]},
                             own_expenses_from=args.own_expenses_from,
                             refund_transfers=rf.map_ids(legacy, anon_legacy, extra["refund_transfers"], "transfers"))
    anon_path = out / f"anonymized-{stamp}.json"
    rf.write_reference(anon, anon_path)
    rf.assert_no_text_leak(legacy, anon_path.read_text(encoding="utf-8"))
    _print_coverage("ANONIMIZADO", anon)
    print(f"\nFicheros en {out}:\n   real-{stamp}.json\n   anonymized-{stamp}.json")
    return 0


def cmd_fixtures_synthetic(args) -> int:
    from . import reference as rf
    from .synthetic import dataset
    from .verify import load_engine
    FinanceCore = load_engine(args.engine_path)
    out = Path(args.out)
    for f in out.glob("synthetic-*.json"):
        f.unlink()
    currents = ["2026-02", "2026-06", "2026-11"]
    for seed in range(args.seeds):
        ref = rf.make_reference(FinanceCore, dataset(seed), "synthetic", "2026-02",
                                [currents[seed % 3], currents[(seed + 1) % 3]],
                                {**_engine_source(args.engine_path), "seed": seed})
        ref.pop("generatedAt")  # ficheros reproducibles: mismo contenido en cada ejecución
        rf.write_reference(ref, out / f"synthetic-{seed:03d}.json")
    print(f"{args.seeds} ficheros sintéticos en {out}")
    return 0


def _split(v) -> list:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def _latest_backup(args) -> Path:
    backups = sorted(Path(args.backup_dir).glob("backup-*.json"))
    path = Path(args.backup) if getattr(args, "backup", None) else (backups[-1] if backups else None)
    if not path:
        raise SystemExit(f"No hay backups en {args.backup_dir}. Ejecuta antes 'backup' o 'inventory'.")
    return path


def cmd_own_expenses(args) -> int:
    from .own_expenses import own_expenses_report, print_report
    legacy, meta = read_backup(_latest_backup(args))
    print(f"Backup: {meta['file']}\n")
    print_report(own_expenses_report(legacy, args.current_month or current_month_madrid()))
    print("Decide:\n  1) el primer mes en que los reembolsos se hacen DENTRO de la app (antes se dan por saldados):"
          "  --own-expenses-from AAAA-MM\n  2) desde ese mes, qué 'otras transferencias' fueron reembolsos:"
          "  --refund-transfers id1,id2,…  (los 8 caracteres entre corchetes)")
    return 0

# --------------------------------------------------------------------------- argparse

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="salary_migrate", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, source=False, target=False):
        sp.add_argument("--backup-dir", default=str(WORKDIR / "backups"))
        sp.add_argument("--reports-dir", default=str(WORKDIR / "reports"))
        if source:
            sp.add_argument("--source-key", help="Clave JSON de la service account del proyecto VIEJO")
            sp.add_argument("--from-backup", help="Usar un backup existente en vez de leer el origen")
        if target:
            sp.add_argument("--target-key", required=True, help="Clave JSON de la service account de salary2-ee33e")
            sp.add_argument("--target-database", default="(default)")
            sp.add_argument("--uid", required=True, help="uid de destino (users/{uid})")

    sp = sub.add_parser("inventory", help="Informe de solo lectura (y backup)")
    common(sp, source=True)
    sp.add_argument("--min-month", default="2026-02")
    sp.set_defaults(func=cmd_inventory)

    sp = sub.add_parser("backup", help="Solo backup JSON")
    common(sp, source=True)
    sp.set_defaults(func=cmd_backup)

    sp = sub.add_parser("migrate", help="Backup + transformación + escritura + verificación")
    common(sp, source=True, target=True)
    sp.add_argument("--min-month", required=True, help="min_managed_month de la app vieja (YYYY-MM)")
    sp.add_argument("--timezone", default="Europe/Madrid")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument("--prune", action="store_true")
    sp.add_argument("--overwrite-edited", action="store_true")
    sp.add_argument("--engine-path", help="Ruta a un clon del repo Salary viejo para comparar cálculos")
    sp.add_argument("--own-expenses-from", help="Mes desde el que los reembolsos de gastos propios se hacen en la app")
    sp.add_argument("--refund-transfers", help="Ids (o prefijos de 8) de transferencias que fueron reembolsos, separados por comas")
    sp.add_argument("--current-month", help="Mes actual para la verificación (por defecto, hoy en Madrid)")
    sp.set_defaults(func=cmd_migrate)

    sp = sub.add_parser("verify", help="Verificar destino contra un backup")
    common(sp, target=True)
    sp.add_argument("--backup", required=True)
    sp.add_argument("--min-month", required=True)
    sp.add_argument("--engine-path")
    sp.add_argument("--current-month")
    sp.set_defaults(func=cmd_verify)

    sp = sub.add_parser("wipe", help="Borrar users/{uid} en el DESTINO")
    common(sp, target=True)
    sp.add_argument("--confirm", required=True)
    sp.set_defaults(func=cmd_wipe)

    sp = sub.add_parser("reference", help="Fase 3: valores de referencia con el motor viejo (real + anonimizado)")
    common(sp)
    sp.add_argument("--engine-path", required=True)
    sp.add_argument("--backup", help="Backup a usar (por defecto, el más reciente)")
    sp.add_argument("--start-month", default="2026-02", help="min_managed_month de la app vieja")
    sp.add_argument("--current-from", help="Primer mes 'actual' (por defecto, el primer mes con datos)")
    sp.add_argument("--current-to", help="Último mes 'actual' (por defecto, hoy en Madrid)")
    sp.add_argument("--out", default=str(WORKDIR / "reference"))
    sp.add_argument("--own-expenses-from")
    sp.add_argument("--refund-transfers")
    sp.set_defaults(func=cmd_reference)

    sp = sub.add_parser("own-expenses", help="Listado de gastos propios y posibles reembolsos (decisión D3)")
    common(sp)
    sp.add_argument("--backup", help="Backup a usar (por defecto, el más reciente)")
    sp.add_argument("--current-month")
    sp.set_defaults(func=cmd_own_expenses)

    sp = sub.add_parser("fixtures-synthetic", help="Fase 3: ficheros de referencia sintéticos para el repo")
    sp.add_argument("--engine-path", required=True)
    sp.add_argument("--out", required=True)
    sp.add_argument("--seeds", type=int, default=12)
    sp.set_defaults(func=cmd_fixtures_synthetic)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "source_key", None) is None and getattr(args, "from_backup", None) is None \
            and args.cmd in ("inventory", "backup", "migrate"):
        print("Falta --source-key (o --from-backup).", file=sys.stderr)
        return 3
    if args.cmd == "backup" and args.from_backup:
        print("backup necesita --source-key.", file=sys.stderr)
        return 3
    return args.func(args)
