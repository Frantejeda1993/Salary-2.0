"""
Datasets sintéticos con la forma de la Firestore vieja. Nunca datos reales.

Cubren todo lo que el motor viejo distingue: tarjeta (mes de cargo explícito o
por defecto, reserva en compra o en cargo, saldadas o no), revisiones de salario
retroactivas, deducciones en esquema legacy, horas extra, fijos con cambios de
importe y de cuenta, gastos propios y su reembolso automático, préstamos con y
sin pendiente explícito, budgets duplicados (bug B3), combustible e importes con
decimales que no son exactos en binario.
"""
from __future__ import annotations

import random
import string
from datetime import datetime, timezone

UTC = timezone.utc
AUTO = "Transferencia automatica gastos"


def ts(y, m, d=1):
    return datetime(y, m, d, tzinfo=UTC)


def fid(rnd) -> str:
    """Id con la forma de un auto-id de Firestore (20 caracteres alfanuméricos)."""
    return "".join(rnd.choice(string.ascii_letters + string.digits) for _ in range(20))


def ym(rnd, lo=(2025, 11), hi=(2026, 12)):
    a, b = lo[0] * 12 + lo[1] - 1, hi[0] * 12 + hi[1] - 1
    i = rnd.randint(a, b)
    return i // 12, i % 12 + 1


def money(rnd, lo, hi):
    return rnd.choice([float(rnd.randint(lo, hi)), round(rnd.uniform(lo, hi), 2), 0.1 * rnd.randint(1, 9) + lo])


def dataset(seed: int) -> dict:
    rnd = random.Random(seed)
    L = {c: [] for c in ["accounts", "banks", "salaries", "overtimes", "expenses", "incomes", "transfers",
                         "categories", "budgets", "fixed_expenses", "fixed_expense_instances",
                         "monthly_account_snapshots", "credit_settlements"]}
    bank = {"id": fid(rnd), "nombre": "Banco", "duenio": "Yo", "created_at": ts(2025, 1, 1)}
    L["banks"].append(bank)
    accs = [fid(rnd) for _ in range(3)]
    for i, a in enumerate(accs):
        L["accounts"].append({"id": a, "bank_id": bank["id"], "nombre": f"Cuenta{i}", "is_main": i == 0,
                              "saldo_inicial": rnd.choice([0.0, 500.0, 1234.56]), "created_at": ts(2025, 1, 2)})
    main = accs[0]
    cats = [{"id": fid(rnd), "nombre": n, "tipo": t} for n, t in
            [("Comida", "normal"), ("Combustible", "normal"), ("Ocio", "normal"), ("Extra", "extra")]]
    L["categories"] = cats
    cat_ids = [c["id"] for c in cats]

    for k in range(rnd.randint(1, 2)):
        sid = fid(rnd)
        s = {"id": sid, "nombre": f"Trabajo{k}", "salario_bruto": rnd.choice([1800.0, 2500.0, 3100.55]),
             "fecha_inicio": ts(*ym(rnd, (2025, 10), (2026, 3)), 1),
             "fecha_fin": ts(2026, rnd.randint(9, 12), 30) if rnd.random() < 0.3 else None,
             "bank_id": bank["id"], "account_id": rnd.choice([main, main, accs[1]])}
        if rnd.random() < 0.3:   # esquema legacy de deducciones
            s.update({"cont_comun": 4.7, "irpf": rnd.choice([10.0, 12.5]), "irpf_aplica_extras": False})
        else:
            s["deductions"] = [
                {"name": "SS", "percentage": 0.0635, "applies_to_extras": True},
                {"name": "IRPF", "percentage": rnd.choice([0.12, 0.153]), "applies_to_extras": rnd.random() < 0.5},
                {"name": "", "percentage": 0.5, "applies_to_extras": True},  # sin nombre: el motor la ignora
            ]
        if rnd.random() < 0.6:
            desde = f"2026-{rnd.randint(2, 7):02d}"
            rev = {"desde": desde, "salario_bruto": s["salario_bruto"] + 150.25}
            if rnd.random() < 0.5:
                rev["cobro_desde"] = f"2026-{min(int(desde[-2:]) + rnd.randint(1, 3), 12):02d}"
            s["revisiones"] = [rev]
        L["salaries"].append(s)
        for _ in range(rnd.randint(0, 3)):
            L["overtimes"].append({"id": fid(rnd), "salary_id": sid, "monto_bruto": money(rnd, 50, 400),
                                   "mes_aplicacion": "%04d-%02d" % ym(rnd)})

    for _ in range(rnd.randint(15, 70)):
        y, m = ym(rnd)
        acc = rnd.choice(accs + [main] * 3)
        e = {"id": fid(rnd), "nombre": "g", "fecha": ts(y, m, rnd.randint(1, 28)), "monto": money(rnd, 3, 600),
             "categoria_id": rnd.choice(cat_ids + [""]), "bank_id": bank["id"], "account_id": acc,
             "created_at": ts(y, m, 1)}
        r = rnd.random()
        if r < 0.3:
            e.update({"metodo_pago": "credito", "reservar_en": rnd.choice(["compra", "cargo"])})
            if rnd.random() < 0.7:   # si falta, el motor usa mes de compra + 1
                idx = y * 12 + m - 1 + rnd.randint(1, 2)
                e["mes_cargo"] = f"{idx // 12:04d}-{idx % 12 + 1:02d}"
        elif r < 0.4:
            e.update({"metodo_pago": "", "mes_cargo": None, "reservar_en": "compra"})
        if rnd.random() < 0.1:
            e.update({"fuel_expense": True, "km_done": 450.0, "price_per_l": 1.559})
        L["expenses"].append(e)

    for _ in range(rnd.randint(0, 12)):
        y, m = ym(rnd)
        L["incomes"].append({"id": fid(rnd), "nombre": "i", "fecha": ts(y, m, rnd.randint(1, 28)),
                             "monto": money(rnd, 5, 300), "categoria_id": rnd.choice(cat_ids + ["", ""]),
                             "bank_id": bank["id"], "account_id": rnd.choice(accs)})

    for _ in range(rnd.randint(0, 12)):
        y, m = ym(rnd)
        o, t = rnd.sample(accs, 2)
        amt = money(rnd, 10, 500)
        tr = {"id": fid(rnd), "fecha": ts(y, m, rnd.randint(1, 28)), "cuenta_origen": o, "cuenta_destino": t,
              "monto": amt, "descripcion": AUTO if (o == main and rnd.random() < 0.4) else ""}
        if rnd.random() < 0.3:
            tr.update({"is_loan": True, "status": rnd.choice(["pending", "paid"])})
            if rnd.random() < 0.6:
                tr["outstanding_amount"] = round(amt * rnd.random(), 2)
        else:
            tr.update({"is_loan": False, "status": "pending", "outstanding_amount": 0.0})
        L["transfers"].append(tr)

    for i, c in enumerate(rnd.sample(cat_ids, rnd.randint(0, 3))):
        acc = rnd.choice([main, main, accs[1]])
        L["budgets"].append({"id": fid(rnd), "categoria_id": c, "account_id": acc, "bank_id": bank["id"],
                             "monto": float(rnd.choice([100, 250, 400.5])),
                             "fecha_inicio": ts(*ym(rnd, (2025, 10), (2026, 4)), 1),
                             "fecha_fin": ts(2026, 11, 30) if rnd.random() < 0.3 else None})
        if rnd.random() < 0.15:  # bug B3: budget duplicado
            L["budgets"].append({**L["budgets"][-1], "id": fid(rnd), "monto": 50.0})

    for k in range(rnd.randint(0, 5)):
        fe_id = fid(rnd)
        fe = {"id": fe_id, "nombre": f"Fijo{k}", "monto": money(rnd, 20, 900), "account_id": rnd.choice(accs),
              "bank_id": bank["id"], "es_propio": rnd.random() < 0.4,
              "fecha_inicio": ts(*ym(rnd, (2025, 10), (2026, 3)), 1),
              "fecha_fin": ts(2026, rnd.randint(6, 12), 28) if rnd.random() < 0.3 else None}
        if rnd.random() < 0.5:
            fe["revisiones"] = sorted([
                {"desde": f"2026-{rnd.randint(2, 6):02d}", "monto": fe["monto"] * 1.05},
                {"desde": f"2026-{rnd.randint(7, 11):02d}", "account_id": rnd.choice(accs), "bank_id": bank["id"]},
            ], key=lambda r: r["desde"])
        L["fixed_expenses"].append(fe)
        for mm in rnd.sample(range(1, 13), rnd.randint(0, 8)):
            L["fixed_expense_instances"].append({
                "id": fid(rnd), "fixed_expense_id": fe_id, "mes": f"2026-{mm:02d}",
                "estado": rnd.choice(["pagado", "pagado", "impagado"]),
                "monto": money(rnd, 20, 900) if rnd.random() < 0.3 else None})

    # Pagos de tarjeta: como mucho uno por (cuenta, mes de cargo)
    groups = {}
    for e in L["expenses"]:
        if e.get("metodo_pago") == "credito":
            mc = e.get("mes_cargo")
            if not mc:
                d = e["fecha"]
                idx = d.year * 12 + d.month
                mc = f"{idx // 12:04d}-{idx % 12 + 1:02d}"
            groups.setdefault((e["account_id"], mc), 0.0)
            groups[(e["account_id"], mc)] += e["monto"]
    for (acc, mc), total in sorted(groups.items()):
        if rnd.random() < 0.6:
            y, m = map(int, mc.split("-"))
            L["credit_settlements"].append({"id": fid(rnd), "account_id": acc, "mes_cargo": mc,
                                             "fecha": ts(y, m, rnd.randint(1, 28)),
                                             "monto": total if rnd.random() < 0.8 else total + 1.0})
    for c in L:
        L[c].sort(key=lambda d: d["id"])
    return L
