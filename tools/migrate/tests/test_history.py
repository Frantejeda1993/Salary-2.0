"""Importador del histórico (Excel mensual) sobre una hoja falsa con datos inventados."""
import pytest

from salary_migrate import history as H
from fake_sheet import workbook


@pytest.fixture
def run():
    tabs = workbook()
    ex = H.extract(tabs, "2026-02")
    plan = H.build_plan(tabs, ex, "2026-02")
    return tabs, ex, plan


def movs(plan, **kw):
    return [m for m in plan.movs if all(getattr(m, k) == v for k, v in kw.items())]


def test_every_section_matches_the_sheet_totals(run):
    _, ex, _ = run
    assert ex.checks and all(c.ok for c in ex.checks), [c for c in ex.checks if not c.ok]


def test_only_rows_the_total_adds_are_spending(run):
    _, ex, _ = run
    fuel = [i for i in ex.items if i.section == "fuel"]
    assert [(i.text, i.counted) for i in fuel] == [("Repsol", True), ("Shell", False)]


def test_dates(run):
    _, ex, _ = run
    by = {i.text: i for i in ex.items if i.month == "2026-01"}
    assert by["Mercadona"].date == "2026-01-02"
    assert by["Pan"].date == "2026-01-01" and by["Pan"].note == "sin fecha"   # enero: sin fecha
    assert by["Cena"].date == "2026-01-10"                                     # '10.01 - Cena'
    feb_pan = [i for i in ex.items if i.text == "Pan" and i.month == "2026-02"][0]
    assert feb_pan.date == "2026-01-30"                                        # fecha del mes anterior: se respeta


def test_parse_date_rejects_typos():
    assert H.parse_date("07.12.2026", "2025-01") == (None, "fecha '07.12.2026' fuera de la pestaña")
    assert H.parse_date("29.11 - Cena", "2025-01")[0] == "2024-11-29"
    assert H.parse_date("6th November", "2023-11")[0] == "2023-11-06"


def test_today_formulas_use_the_value_of_their_month(run):
    _, _, plan = run
    jan = plan.remains[0]
    assert jan.artifact and jan.cached == 0 and jan.intended == 100
    assert plan.initial[H.POOL] == 100


def test_pool_balance_equals_the_sheet_remaining_every_month(run):
    _, _, plan = run
    assert [(c.tab, c.sheet, c.ours, c.ok) for c in plan.checks] == [
        ("January 26", 799.5, 799.5, True), ("February 26", 1594.5, 1594.5, True)]


def test_cash_atm_card_mami_and_savings(run):
    _, _, plan = run
    # Cajero: una sola transferencia (la de Extras), no también la de la lista de efectivo.
    atm = movs(plan, kind="transfer", description="Cajero")
    assert [(m.amount, m.account, m.to) for m in atm] == [(50.0, H.POOL, H.CASH)]
    # El efectivo que la hoja suma al total entra en el remanente y sale al mes siguiente.
    assert [(m.month, m.account, m.to) for m in plan.movs if "Efectivo" in m.description and m.kind == "transfer"] == [
        ("2026-01", H.CASH, H.POOL), ("2026-02", H.POOL, H.CASH)]
    # «Last month» es arrastre, no un ingreso.
    assert not movs(plan, description="Last month")
    # Tarjeta: compra con cargo el mes siguiente y su pago.
    card = [m for m in plan.movs if m.card and m.kind == "expense"]
    assert [(m.amount, m.card["chargeMonth"]) for m in card] == [(30.0, "2026-02")]
    assert [(m.month, m.amount) for m in movs(plan, kind="settlement")] == [("2026-02", 30.0)]
    # Mami: ingreso y cuota en su cuenta; préstamos nuevos (acumulado − arrastrado) y devolución.
    assert [(m.kind, m.amount) for m in plan.movs if m.account == H.MAMI and m.kind != "transfer"] == [
        ("income", 500.0), ("expense", 400.0)]
    loans = movs(plan, transfer_kind="loan")
    assert [(m.month, m.amount, m.account, m.to) for m in loans] == [
        ("2026-01", 30.0, H.MAMI, H.POOL), ("2026-02", 5.0, H.MAMI, H.POOL)]
    assert [(m.amount, m.to) for m in movs(plan, transfer_kind="loanRepayment")] == [(30.0, H.MAMI)]
    # Ahorro: transferencia, no gasto.
    assert [(m.amount, m.to) for m in movs(plan, description="Saves")] == [(100.0, H.SAVINGS)]
    # Ingresos de Extras (negativos en la hoja).
    assert [(m.kind, m.amount) for m in movs(plan, description="Nacho")] == [("income", 60.0)]


def test_no_manual_adjustments_needed_here(run):
    _, _, plan = run
    assert not [m for m in plan.movs if m.category == "ajuste"]


def test_manual_change_of_the_remaining_becomes_an_ajuste():
    tabs = workbook()
    feb = tabs[1]
    feb._v.cells[(11, 3)] = 674.5            # cacheado: 699.5 - 25
    feb._f.cells[(11, 3)] = "='January 26'!H19-25"
    # (el resto de celdas de febrero no cambian: el cuadre debe fallar sin el ajuste)
    ex = H.extract(tabs, "2026-02")
    plan = H.build_plan(tabs, ex, "2026-02")
    aj = [m for m in plan.movs if m.category == "ajuste"]
    assert [(m.month, m.kind, m.amount) for m in aj] == [("2026-02", "expense", 25.0)]
    assert "='January 26'!H19-25" in aj[0].note


def test_firestore_documents(run):
    _, _, plan = run
    cats = {"c1": {"name": "Comida"}, "c2": {"name": "Gasolina"}, "c3": {"name": "Extra"}}
    docs = H.history_docs(plan, cats)
    assert all(a["archived"] and a["source"] == "history" for a in docs["accounts"].values())
    assert set(docs["accounts"]) == {"hist_excel", "hist_excel_ahorros", "hist_excel_mami", "hist_excel_efectivo"}
    assert docs["accounts"]["hist_excel"]["initialBalance"] == 100
    # Reutiliza las categorías que ya existen y crea solo 'Ajuste'.
    assert list(docs["categories"]) == ["hist_cat_ajuste"]
    m = docs["movements"]
    assert all(d["source"] == "history" and d["accountId"].startswith("hist_") for d in m.values())
    assert {d["categoryId"] for d in m.values() if d["type"] == "expense"} <= {"c1", "c2", "c3", None}
    loans = [d for d in m.values() if d.get("transferKind") == "loan"]
    assert loans and all(d["loan"] == {"status": "paid", "outstanding": 0.0} for d in loans)
    fuel = [d for d in m.values() if d.get("fuel")]
    assert fuel == [next(d for d in m.values() if d["description"] == "Repsol")]
    assert fuel[0]["fuel"] == {"km": 600.0, "pricePerLiter": 1.5}
    assert list(docs["cardSettlements"]) == ["hist_excel_card_2026-02"]
    # Ids estables: misma hoja, mismos documentos.
    assert H.history_docs(H.build_plan(workbook(), H.extract(workbook(), "2026-02"), "2026-02"), cats) == docs


def test_history_never_changes_the_app_figures(FinanceCore, legacy_path):
    """Con o sin histórico, toda cifra de las cuentas reales es idéntica (motor viejo)."""
    from salary_migrate.synthetic import dataset
    from salary_migrate.transform import transform
    from salary_migrate.verify import history_invariant
    L = dataset(7)
    p = transform(L, "uid", "2026-02", timezone="Europe/Madrid")
    tabs = workbook()
    plan = H.build_plan(tabs, H.extract(tabs, "2026-02"), "2026-02")
    hist = H.history_docs(plan, p.docs["categories"])
    inv = history_invariant(p.profile, p.docs, hist, engine_path=legacy_path, current_month="2026-06",
                            min_month="2026-02", until="2026-02")
    assert inv["compared"] > 500 and inv["mismatches"] == []


def test_your_corrections():
    """Un mes perdido: cierre real conocido, compras con tarjeta sin detalle y un préstamo."""
    tabs = workbook()
    fixes = {
        "items": [
            {"month": "2026-01", "type": "card", "amount": 40, "chargeMonth": "2026-02", "description": "Tarjeta del viaje"},
            {"month": "2026-01", "type": "loan", "amount": 20, "description": "Préstamo de Mami"},
            {"month": "2026-01", "type": "income", "amount": 5, "category": "gasolina", "description": "Mitad del combustible"},
        ],
        "closing": {"2026-01": {"amount": 700, "description": "Gastos sin apuntar"}},
        "remain": {"2026-02": 700},
    }
    # Febrero arrastra a mano el total de enero menos el efectivo: con la corrección arrastra 700.
    plan = H.build_plan(tabs, H.extract(tabs, "2026-02"), "2026-02", fixes)
    assert all(c.ok for c in plan.checks), plan.checks
    assert [c.ours for c in plan.checks] == [700.0, 700.0 + 1594.5 - 764.5]
    # Enero: 799,5 (hoja) + 20 (préstamo) + 5 (ingreso) − X = 700  →  X = 124,5 sin apuntar
    sin = [m for m in plan.movs if m.description == "Gastos sin apuntar"]
    assert [(m.kind, m.amount) for m in sin] == [("expense", 124.5)]
    # La tarjeta del viaje se cobra con la fila 'Tarjeta' de febrero junto a la cena (30 + 40 ≠ 30: aviso).
    assert [m.amount for m in plan.movs if m.kind == "settlement"] == [30.0]
    assert plan.warnings and "70.00" in plan.warnings[0]
    # Sin ajuste en febrero: el arrastre ya es el cierre corregido.
    assert not [m for m in plan.movs if m.category == "ajuste"]
    assert any("2026-01: hoja 799.50 → 700.00" in line for line in H.report_lines(H.extract(tabs, "2026-02"), plan))
