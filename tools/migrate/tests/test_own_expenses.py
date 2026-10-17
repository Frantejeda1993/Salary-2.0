"""Decisión D3 (opción b): histórico de gastos propios y transferencias que fueron reembolsos."""
from salary_migrate.own_expenses import own_expenses_report, print_report
from salary_migrate.reverse import to_legacy
from salary_migrate.synthetic import dataset, ts
from salary_migrate.transform import transform


def world():
    L = dataset(21)
    main = next(a["id"] for a in L["accounts"] if a["is_main"])
    sec = next(a["id"] for a in L["accounts"] if not a["is_main"])
    L["fixed_expenses"] = [{"id": "gymgymgym1", "nombre": "Gym", "monto": 34.75, "account_id": sec, "es_propio": True,
                            "fecha_inicio": ts(2026, 3), "fecha_fin": None}]
    L["fixed_expense_instances"] = [{"id": f"i{m}", "fixed_expense_id": "gymgymgym1", "mes": f"2026-0{m}",
                                     "estado": "pagado", "monto": None} for m in (3, 4, 5)]
    L["transfers"] = [{"id": "manualrefund01", "fecha": ts(2026, 4, 3), "cuenta_origen": main, "cuenta_destino": sec,
                       "monto": 69.5, "descripcion": "", "is_loan": False}]
    return L, main, sec


def test_report_lists_owed_months_and_manual_transfers(capsys):
    L, main, sec = world()
    rep = own_expenses_report(L, "2026-06")
    rows = rep["accounts"][sec]
    assert rows["2026-03"]["owed"] == 34.75 and rows["2026-06"]["owed"] == 34.75   # futuro/actual: previsto
    assert [t["id"] for t in rows["2026-04"]["other"]] == ["manualrefund01"]
    print_report(rep)
    assert "[manualre]" in capsys.readouterr().out


def test_marked_transfers_become_refunds_and_settings_get_tracking_month():
    L, _, _ = world()
    plan = transform(L, "u", "2026-02", own_expenses_from="2026-04", refund_transfers=["manualre"])
    assert plan.ok, plan.errors
    assert plan.docs["movements"]["manualrefund01"]["transferKind"] == "ownExpenseRefund"
    assert plan.profile["settings"]["ownExpensesFrom"] == "2026-04"
    # el motor viejo no cambia: la descripción se conserva y la verificación sigue siendo exacta
    back = to_legacy(plan.profile, plan.docs)
    assert next(t for t in back["transfers"] if t["id"] == "manualrefund01")["descripcion"] == ""


def test_ambiguous_or_wrong_refund_ids_block():
    L, _, _ = world()
    assert any(e["code"] == "bad_refund_id" for e in transform(L, "u", "2026-02", refund_transfers=["zzzzzzzz"]).errors)
    assert any(e["code"] == "bad_refund_id" for e in transform(L, "u", "2026-02", refund_transfers=["man"]).errors)
