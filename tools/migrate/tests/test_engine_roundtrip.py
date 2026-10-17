"""
La prueba central: el motor de cálculo VIEJO da exactamente las mismas cifras
con los datos originales que con los datos migrados (convertidos de vuelta).
Igualdad exacta (==), no solo al céntimo.
"""
import pytest

from datasets import dataset
from salary_migrate.reverse import to_legacy
from salary_migrate.transform import transform
from salary_migrate.verify import _months, compare_metrics, engine_metrics

SEEDS = range(150)
CURRENTS = ["2026-01", "2026-04", "2026-08", "2026-12"]


@pytest.mark.parametrize("seed", SEEDS)
def test_engine_identical_after_migration(FinanceCore, seed):
    L = dataset(seed)
    plan = transform(L, "u", "2026-02")
    assert plan.ok, plan.errors
    back = to_legacy(plan.profile, plan.docs)
    current = CURRENTS[seed % len(CURRENTS)]
    months = _months(FinanceCore(L, current, "2026-02"), "2026-02", current)
    a = engine_metrics(FinanceCore, L, current, "2026-02", months)
    b = engine_metrics(FinanceCore, back, current, "2026-02", months)
    cmp = compare_metrics(a, b)
    assert cmp["mismatches"] == []
    assert cmp["max_abs_diff"] == 0.0
    assert cmp["compared"] > 100


def test_wrong_start_month_is_detected(FinanceCore):
    L = dataset(0)
    plan = transform(L, "u", "2026-04")          # se migró con otro min_managed_month
    back = to_legacy(plan.profile, plan.docs)
    months = _months(FinanceCore(L, "2026-08", "2026-02"), "2026-02", "2026-08")
    a = engine_metrics(FinanceCore, L, "2026-08", "2026-02", months)
    b = engine_metrics(FinanceCore, back, "2026-08", plan.profile["settings"]["startMonth"], months)
    assert compare_metrics(a, b)["mismatches"]
