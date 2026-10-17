"""Reglas de la transformación y paradas ante datos ambiguos."""
import copy

import pytest

from salary_migrate.synthetic import dataset, ts
from salary_migrate.transform import card_id_for, settlement_id, transform


def plan_for(L, month="2026-02"):
    return transform(L, "uid1", month)


def test_dataset_is_migratable_and_keeps_ids():
    L = dataset(1)
    p = plan_for(L)
    assert p.ok, p.errors
    assert set(p.docs["accounts"]) == {a["id"] for a in L["accounts"]}
    assert set(p.docs["movements"]) == {d["id"] for c in ("expenses", "incomes", "transfers") for d in L[c]}
    assert p.profile["settings"]["mainAccountId"] == next(a["id"] for a in L["accounts"] if a["is_main"])
    assert p.profile["settings"]["startMonth"] == "2026-02"


@pytest.mark.parametrize("n_main", [0, 2])
def test_requires_exactly_one_main_account(n_main):
    L = dataset(2)
    for i, a in enumerate(L["accounts"]):
        a["is_main"] = i < n_main
    assert any(e["code"] == "main_account" for e in plan_for(L).errors)


def test_duplicate_fixed_instance_blocks():
    L = dataset(3)
    fe = {"id": "fe1", "nombre": "x", "monto": 10.0, "account_id": L["accounts"][0]["id"],
          "fecha_inicio": ts(2026, 1)}
    L["fixed_expenses"].append(fe)
    L["fixed_expense_instances"] += [
        {"id": "i1", "fixed_expense_id": "fe1", "mes": "2026-03", "estado": "pagado", "monto": None},
        {"id": "i2", "fixed_expense_id": "fe1", "mes": "2026-03", "estado": "pagado", "monto": 9.0}]
    assert any(e["code"] == "duplicate_instance" for e in plan_for(L).errors)


def test_duplicate_settlement_blocks():
    L = dataset(4)
    acc = L["accounts"][0]["id"]
    L["credit_settlements"] = [
        {"id": "s1", "account_id": acc, "mes_cargo": "2026-04", "fecha": ts(2026, 4, 5), "monto": 300.0},
        {"id": "s2", "account_id": acc, "mes_cargo": "2026-04", "fecha": ts(2026, 4, 6), "monto": 300.0}]
    assert any(e["code"] == "duplicate_settlement" for e in plan_for(L).errors)


def test_missing_date_or_amount_blocks():
    L = dataset(5)
    L["expenses"][0]["fecha"] = None
    L["incomes"].append({"id": "zz", "fecha": ts(2026, 3), "monto": "12", "account_id": L["accounts"][0]["id"]})
    codes = {e["code"] for e in plan_for(L).errors}
    assert {"missing_date", "missing_amount"} <= codes


def test_credit_defaults_are_materialized_like_the_old_engine():
    L = dataset(6)
    acc = L["accounts"][0]["id"]
    L["expenses"].append({"id": "cc", "fecha": ts(2026, 12, 20), "monto": 50.0, "account_id": acc,
                          "categoria_id": "", "metodo_pago": "credito"})
    m = plan_for(L).docs["movements"]["cc"]
    assert m["card"] == {"cardId": card_id_for(acc), "chargeMonth": "2027-01", "reserveIn": "purchase"}
    assert m["categoryId"] is None


def test_loan_outstanding_defaults_to_amount():
    L = dataset(7)
    a, b = L["accounts"][0]["id"], L["accounts"][1]["id"]
    L["transfers"].append({"id": "ln", "fecha": ts(2026, 2), "cuenta_origen": a, "cuenta_destino": b,
                           "monto": 400.0, "is_loan": True})
    m = plan_for(L).docs["movements"]["ln"]
    assert m["transferKind"] == "loan" and m["loan"] == {"status": "pending", "outstanding": 400.0}


def test_auto_refund_transfer_is_tagged_and_description_kept():
    L = dataset(8)
    a, b = L["accounts"][0]["id"], L["accounts"][1]["id"]
    L["transfers"].append({"id": "rf", "fecha": ts(2026, 2), "cuenta_origen": a, "cuenta_destino": b,
                           "monto": 40.0, "descripcion": "Transferencia automatica gastos"})
    m = plan_for(L).docs["movements"]["rf"]
    assert m["transferKind"] == "ownExpenseRefund"
    assert m["description"] == "Transferencia automatica gastos"


def test_legacy_deductions_are_resolved_once():
    L = dataset(9)
    s = L["salaries"][0]
    s.pop("deductions", None)
    s.update({"cont_comun": 4.7, "irpf": 10.0})
    ded = plan_for(L).docs["salaries"][s["id"]]["deductions"]
    assert [(d["name"], d["rate"]) for d in ded] == [
        ("Cont. Común", 4.7 / 100.0), ("MEI", 0.1 / 100.0), ("Formación", 0.1 / 100.0),
        ("Desempleo", 0.1 / 100.0), ("IRPF", 10.0 / 100.0)]


def test_unknown_fields_are_preserved_not_dropped():
    L = dataset(10)
    L["expenses"][0]["nota_vieja"] = "algo"
    p = plan_for(L)
    assert p.docs["movements"][L["expenses"][0]["id"]]["legacy"]["extra"] == {"nota_vieja": "algo"}
    assert any(w["code"] == "unknown_fields" for w in p.warnings)


def test_categories_lose_kind_but_keep_trace():
    L = dataset(11)
    extra = next(c for c in L["categories"] if c["tipo"] == "extra")
    doc = plan_for(L).docs["categories"][extra["id"]]
    assert "kind" not in doc and doc["legacy"]["kind"] == "extra"


def test_settlement_id_is_deterministic():
    L = dataset(12)
    p = plan_for(L)
    for st in L["credit_settlements"]:
        assert settlement_id(card_id_for(st["account_id"]), st["mes_cargo"]) in p.docs["cardSettlements"]


def test_transform_does_not_mutate_input():
    L = dataset(13)
    before = copy.deepcopy(L)
    plan_for(L)
    assert L == before


def test_stale_es_propio_on_expenses_is_dropped_with_one_warning():
    L = dataset(14)
    for e in L["expenses"]:
        e["es_propio"] = False
    p = plan_for(L)
    assert all("extra" not in m["legacy"] for m in p.docs["movements"].values() if m["type"] == "expense")
    ws = [w for w in p.warnings if w["code"] == "ignored_field"]
    assert len(ws) == 1 and ws[0]["count"] == len(L["expenses"])
    assert not any(w["code"] == "unknown_fields" for w in p.warnings)


def _two_budgets(first_end, second_start):
    L = dataset(15)
    L["budgets"] = [
        {"id": "b1", "categoria_id": L["categories"][0]["id"], "account_id": L["accounts"][0]["id"],
         "monto": 100.0, "fecha_inicio": ts(2026, 3), "fecha_fin": first_end},
        {"id": "b2", "categoria_id": L["categories"][0]["id"], "account_id": L["accounts"][0]["id"],
         "monto": 150.0, "fecha_inicio": second_start, "fecha_fin": None}]
    return [w for w in plan_for(L).warnings if w["code"] == "duplicate_budget"]


def test_budget_replaced_by_a_new_one_is_not_a_duplicate():
    assert _two_budgets(ts(2026, 5, 31), ts(2026, 6, 1)) == []


def test_overlapping_budgets_are_flagged():
    ws = _two_budgets(ts(2026, 6, 30), ts(2026, 6, 1))
    assert len(ws) == 1 and "2026-06–2026-06" in ws[0]["message"]
