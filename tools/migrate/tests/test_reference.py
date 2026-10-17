"""Fase 3: valores de referencia, anonimización y ficheros del repo."""
import json
from pathlib import Path

import pytest

from salary_migrate import reference as rf
from salary_migrate.synthetic import dataset

SEED_RICH = 2  # tiene budgets, pagos de tarjeta y gastos propios
FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "reference"


def test_reference_case_has_every_metric_family(FinanceCore):
    ref = rf.make_reference(FinanceCore, dataset(SEED_RICH), "synthetic", "2026-02", ["2026-06"])
    keys = ref["cases"][0]["metrics"].keys()
    for fam in ("|summary|resultado_proyectado", "|summary|remaining_from_previous_month", "|real_balance",
                "|projected_balance", "|month_projected_pre", "|budget|", "|salary|", "|card_outstanding_all"):
        assert any(fam in k for k in keys), fam


def test_anonymized_keeps_structure_and_hides_text(FinanceCore):
    L = dataset(5)
    L["expenses"][0]["nombre"] = "Mercadona Calle Mayor"
    L["accounts"][0]["nombre"] = "Cuenta nómina Francisco"
    A = rf.anonymize(L, seed=1)
    # mismo número de documentos y mismo orden relativo de ids
    for c in L:
        assert len(A[c]) == len(L[c])
        assert [d["id"] for d in A[c]] == sorted(d["id"] for d in A[c])
    ref = rf.make_reference(FinanceCore, A, "anonymized", "2026-02", ["2026-06"])   # se autoverifica
    text = json.dumps(rf.encode(ref), ensure_ascii=False)
    rf.assert_no_text_leak(L, text)
    assert "Mercadona" not in text and "Francisco" not in text
    # la tarjeta, los préstamos y los reembolsos automáticos siguen ahí
    assert ref["coverage"]["data"]["credit_purchases"] == sum(1 for e in L["expenses"] if e.get("metodo_pago") == "credito")
    assert ref["coverage"]["data"]["auto_refunds"] == sum(1 for t in L["transfers"]
                                                         if t.get("descripcion") == rf.AUTO_TRANSFER_DESCRIPTION)


def test_anonymization_keeps_months_but_not_amounts():
    L = dataset(6)
    A = rf.anonymize(L, seed=2)
    by_month = lambda D: sorted(rf.as_date(e["fecha"]).strftime("%Y-%m") for e in D["expenses"])
    assert by_month(A) == by_month(L)
    assert sorted(e["monto"] for e in A["expenses"]) != sorted(e["monto"] for e in L["expenses"])


def test_leak_detector_catches_a_leak():
    L = dataset(7)
    L["expenses"][0]["nombre"] = "Farmacia Pepe"
    with pytest.raises(AssertionError):
        rf.assert_no_text_leak(L, '{"x": "Farmacia Pepe"}')


@pytest.mark.parametrize("seed", [0, 7])
def test_committed_synthetic_fixtures_are_up_to_date(FinanceCore, seed):
    """Los ficheros del repo salen de este código y de este motor. Si algo cambia, hay que regenerarlos."""
    path = FIXTURES / f"synthetic-{seed:03d}.json"
    assert path.exists(), "Faltan los ficheros: python -m salary_migrate fixtures-synthetic ..."
    committed = json.loads(path.read_text(encoding="utf-8"))
    currents = [c["currentMonth"] for c in committed["cases"]]
    fresh = rf.make_reference(FinanceCore, dataset(seed), "synthetic", "2026-02", currents)
    fresh = json.loads(json.dumps(rf.encode(fresh)))
    assert fresh["dataset"] == committed["dataset"]
    assert fresh["cases"] == committed["cases"]


def test_fixture_numbers_survive_json_exactly():
    """repr(float) en Python y JSON.parse en JS dan el mismo double: lo comprobamos del lado Python."""
    committed = json.loads((FIXTURES / "synthetic-001.json").read_text(encoding="utf-8"))
    for v in list(committed["cases"][0]["metrics"].values())[:500]:
        assert float(repr(v)) == v


def test_reference_command_end_to_end(tmp_path, legacy_path, FinanceCore):
    from salary_migrate import cli
    from salary_migrate.source import write_backup
    L = dataset(SEED_RICH)
    L["expenses"][0]["nombre"] = "Supermercado Secreto"
    write_backup(L, "salary-old", tmp_path / "backups")
    rc = cli.main(["reference", "--engine-path", legacy_path, "--backup-dir", str(tmp_path / "backups"),
                   "--out", str(tmp_path / "ref"), "--current-from", "2026-03", "--current-to", "2026-05"])
    assert rc == 0
    real = next((tmp_path / "ref").glob("real-*.json")).read_text(encoding="utf-8")
    anon = next((tmp_path / "ref").glob("anonymized-*.json")).read_text(encoding="utf-8")
    assert "Supermercado Secreto" not in anon                    # el real no se toca, el anonimizado sí
    assert [c["currentMonth"] for c in json.loads(anon)["cases"]] == ["2026-03", "2026-04", "2026-05"]
    assert json.loads(real)["kind"] == "real"
