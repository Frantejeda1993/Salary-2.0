"""
Histórico anterior a la app: lee el Excel mensual de Francisco (una pestaña por mes,
nov-2023 → feb-2026) y lo convierte en movimientos del modelo nuevo.

Principio: lo que cuenta es lo que la HOJA contaba. Cada lista (comida, extras,
combustible, Argentina) tiene una celda total con una fórmula; solo son gasto las filas
que esa fórmula suma. Las demás filas son registro (km, tickets pagados con tarjeta…) y
se informan, no se importan. Las sumas de cada sección se comparan con la hoja al céntimo.

Este módulo no lee ni escribe Firestore: produce un plan y un informe. Los datos reales
nunca van al repositorio; los tests usan hojas inventadas.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12, "dicember": 12,
}
LIST_SECTIONS = {"food": "food", "extras": "extras", "fuel": "fuel", "argentina": "argentina"}

# Etiquetas de la columna E (gastos fijos) que no son un gasto fijo sino otra cosa.
FIXED_SKIP = {"salary", "fuel", "food", "total"}
FIXED_TO_SAVINGS = {"saves", "invest"}
# Columna G (costes variables).
VAR_SKIP = {"salary", "extras", "total"}

A1 = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")
RANGE = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)")


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def col_letters(i: int) -> str:
    s = ""
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def cents(v: float) -> int:
    return int(round(v * 100))


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# --------------------------------------------------------------------------- hoja

class Tab:
    """Una pestaña: valores calculados y fórmulas, por (fila, columna) 1-based."""

    def __init__(self, name: str, values, formulas):
        self.name = name
        self._v = values
        self._f = formulas
        self.month = tab_month(name)

    def v(self, r: int, c: int):
        return self._v.cell(r, c).value

    def f(self, r: int, c: int):
        x = self._f.cell(r, c).value
        return x if isinstance(x, str) and x.startswith("=") else None

    def ref(self, r: int, c: int) -> str:
        return f"{self.name}!{col_letters(c)}{r}"

    def find(self, label: str, rows=range(1, 30), cols=range(1, 30), exact=True):
        lab = label.lower()
        for r in rows:
            for c in cols:
                x = self.v(r, c)
                if isinstance(x, str):
                    s = x.strip().lower()
                    if (s == lab) if exact else s.startswith(lab):
                        return r, c
        return None


def tab_month(name: str) -> str | None:
    m = re.match(r"^\s*([A-Za-z]+)\s+(\d{2})\s*$", name)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return f"20{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"


def load_tabs(path) -> list[Tab]:
    import openpyxl
    values = openpyxl.load_workbook(path, data_only=True)
    formulas = openpyxl.load_workbook(path, data_only=False)
    tabs = [Tab(ws.title, ws, formulas[ws.title]) for ws in values.worksheets]
    return [t for t in tabs if t.month]


# --------------------------------------------------------------------------- fechas

def add_months(month: str, n: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    i = y * 12 + (m - 1) + n
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def parse_date(raw, tab_month_: str) -> tuple[str | None, str | None]:
    """Fecha de una celda o del principio de un texto ('29.11 - Cena'). Devuelve (fecha, nota).
    Una fecha a más de un mes de la pestaña se considera errata: se usa el día 1 del mes."""
    d = None
    if isinstance(raw, (datetime, date)):
        d = date(raw.year, raw.month, raw.day)
    elif isinstance(raw, str):
        s = raw.strip()
        m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b", s)
        m2 = re.match(r"^(\d{4})-(\d{2})-(\d{2})\b", s)
        m3 = re.match(r"^(\d{1,2})[./](\d{1,2})\b", s)
        m4 = re.match(r"^(\d{1,2})(st|nd|rd|th)\s+([A-Za-z]+)", s)
        try:
            if m:
                y = int(m.group(3))
                d = date(y + 2000 if y < 100 else y, int(m.group(2)), int(m.group(1)))
            elif m2:
                d = date(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)))
            elif m3:
                mo = int(m3.group(2))
                ty, tm = int(tab_month_[:4]), int(tab_month_[5:7])
                y = ty - 1 if mo > tm + 1 else ty  # '29.11' en la pestaña de enero = año anterior
                d = date(y, mo, int(m3.group(1)))
            elif m4 and m4.group(3).lower() in MONTHS:
                d = date(int(tab_month_[:4]), MONTHS[m4.group(3).lower()], int(m4.group(1)))
        except ValueError:
            return None, f"fecha imposible {raw!r}"
    if d is None:
        return None, None
    iso = d.isoformat()
    lo, hi = add_months(tab_month_, -2), add_months(tab_month_, 1)
    if not (lo <= iso[:7] <= hi):
        return None, f"fecha {raw!r} fuera de la pestaña"
    return iso, None


def strip_date_prefix(text: str) -> str:
    return re.sub(r"^\s*\d{1,2}[./]\d{1,2}([./]\d{2,4})?\s*-\s*", "", text or "").strip()


# --------------------------------------------------------------------------- fórmulas

def referenced_cells(formula: str | None) -> set[tuple[int, int]] | None:
    """Celdas de la misma pestaña que suma una fórmula de total (None = no es fórmula).
    En las fórmulas con IF(...) del tipo 'Left over' basta con la unión de los SUM."""
    if not formula:
        return None
    body = re.sub(r"'[^']+'!\$?[A-Z]+\$?\d+", "", formula)  # referencias a otras pestañas: fuera
    body = re.sub(r"DATE\([^)]*\)", "", body)
    cells: set[tuple[int, int]] = set()
    for m in RANGE.finditer(body):
        c1, r1, c2, r2 = col_index(m.group(1)), int(m.group(2)), col_index(m.group(3)), int(m.group(4))
        for r in range(min(r1, r2), max(r1, r2) + 1):
            for c in range(min(c1, c2), max(c1, c2) + 1):
                cells.add((r, c))
    rest = RANGE.sub("", body)
    for m in A1.finditer(rest):
        cells.add((int(m.group(2)), col_index(m.group(1))))
    return cells


def formula_constant(formula: str | None) -> float:
    """Término constante de una suma simple '=Q6+Q11+28' (sin IF). 0 si no aplica."""
    if not formula or "IF" in formula.upper() or "SUM(" in formula.upper():
        return 0.0
    body = A1.sub("0", formula[1:])
    if not re.fullmatch(r"[0-9.+\-\s]+", body):
        return 0.0
    try:
        return float(eval(body, {"__builtins__": {}}))  # solo dígitos, puntos y signos
    except Exception:
        return 0.0


# --------------------------------------------------------------------------- partidas

@dataclass
class Item:
    tab: str
    month: str
    section: str        # salary | fixed | savings | variable | food | extras | fuel | argentina | card | cash
    cell: str
    text: str
    amount: float       # tal cual en la hoja (gasto positivo; en extras/efectivo el signo importa)
    date: str | None = None
    note: str | None = None
    counted: bool = True
    extra: dict = field(default_factory=dict)


@dataclass
class Check:
    tab: str
    what: str
    sheet: float | None
    ours: float
    ok: bool
    note: str = ""


@dataclass
class Extraction:
    items: list[Item] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    balances: dict = field(default_factory=dict)  # tab -> {bolsa: valor en la hoja}


CARRY = re.compile(r"^(last month|mes pasado|mes anterior)$", re.I)


def extract(tabs: list[Tab], until: str) -> Extraction:
    out = Extraction()
    out.prev_totals = {}  # type: ignore[attr-defined]
    for t in tabs:
        if t.month > until:
            continue
        _salary(t, out)
        _fixed(t, out)
        _variables(t, out)
        for label, section in LIST_SECTIONS.items():
            pos = t.find(label, rows=range(1, 5), cols=range(9, 40))
            if pos:
                _list(t, out, section, *pos)
        _block_list(t, out, "card", "Card Next Month", amount_col_offset=1)
        _block_list(t, out, "cash", "Efectivo", amount_col_offset=1)
        out.balances[t.name] = _balances(t)
    return out


def _label_rows(t: Tab, col: int, start: int, stop_label: str = "total", max_rows: int = 40):
    """Filas (r, etiqueta) bajo una cabecera en `col`, hasta la fila 'Total'."""
    r = start + 1
    while r < start + max_rows:
        lab = t.v(r, col)
        if isinstance(lab, str) and lab.strip().lower() == stop_label:
            return
        if isinstance(lab, str) and lab.strip():
            yield r, lab.strip()
        r += 1


def _salary(t: Tab, out: Extraction):
    total = t.find("total", cols=range(1, 2))
    remain = t.find("remain", cols=range(1, 2), exact=False) or t.find("remaing", cols=range(1, 2), exact=False)
    if not total:
        out.warnings.append(f"{t.name}: sin fila 'Total' de la nómina.")
        return
    tv = t.v(total[0], 3)
    rv = t.v(remain[0], 3) if remain else 0
    if not is_num(tv):
        out.warnings.append(f"{t.name}: total de nómina no numérico ({tv!r}).")
        return
    net = tv - (rv if is_num(rv) else 0)
    out.items.append(Item(t.name, t.month, "salary", t.ref(total[0], 3), "Nómina", round(net, 6),
                          date=f"{t.month}-01", extra={"total": tv, "remain": rv}))


def _fixed(t: Tab, out: Extraction):
    head = t.find("fixed costs", cols=range(5, 6))
    if not head:
        return
    for r, lab in _label_rows(t, 5, head[0]):
        key = lab.lower()
        amt = t.v(r, 6)
        if key in FIXED_SKIP or not is_num(amt) or abs(amt) < 0.005:
            continue
        d, note = parse_date(t.v(r, 4), t.month)
        section = "savings" if key in FIXED_TO_SAVINGS else "fixed"
        out.items.append(Item(t.name, t.month, section, t.ref(r, 6), lab, float(amt),
                              date=d or f"{t.month}-01", note=note, extra={"paid": bool(d)}))


def _variables(t: Tab, out: Extraction):
    head = t.find("variables cost", cols=range(7, 8))
    if not head:
        return
    for r, lab in _label_rows(t, 7, head[0]):
        key = lab.lower()
        amt = t.v(r, 8)
        if key in VAR_SKIP or not is_num(amt):
            continue
        out.items.append(Item(t.name, t.month, "variable", t.ref(r, 8), lab, float(amt),
                              date=f"{t.month}-01", extra={"formula": t.f(r, 8)}))


def _list(t: Tab, out: Extraction, section: str, hr: int, hc: int):
    """Lista con cabecera en (hr, hc): texto en hc, importe en hc+1, fecha en hc-1."""
    total_v, total_f = t.v(hr, hc + 1), t.f(hr, hc + 1)
    counted_cells = referenced_cells(total_f)
    source = "cabecera"
    if counted_cells is None and total_v is None and section in ("food", "fuel"):
        # Sin total en la lista: manda la fila de la columna de fijos (E) que la resume.
        row = t.find(section, cols=range(5, 6))
        if row and t.f(row[0], 6):
            counted_cells = referenced_cells(t.f(row[0], 6))
            source = "fila de fijos"
        elif row and is_num(t.v(row[0], 6)):
            counted_cells, total_v = set(), t.v(row[0], 6)  # importe escrito a mano: las filas son solo registro
            source = "fila de fijos (importe fijo)"
    elif counted_cells is None and is_num(total_v):
        counted_cells = set()  # total escrito a mano: ninguna fila suma; se informa la diferencia
        source = "total escrito a mano"
    const = formula_constant(total_f)
    r, empty = hr + 1, 0
    items: list[Item] = []
    while r < hr + 1100 and empty < 4:
        text, amt = t.v(r, hc), t.v(r, hc + 1)
        if text is None and amt is None:
            empty += 1
            r += 1
            continue
        empty = 0
        if is_num(amt):
            raw_date = t.v(r, hc - 1) if hc > 1 else None
            d, note = parse_date(raw_date, t.month)
            if d is None and section == "fuel" and isinstance(text, str):
                d2, _ = parse_date(text, t.month)
                if d2:
                    d, text = d2, "Gasolina"
            counted = counted_cells is None or (r, hc + 1) in counted_cells
            extra = {"formula": t.f(r, hc + 1)}
            if section == "fuel":
                km, price = t.v(r, hc + 2), t.v(r, hc + 5)
                extra.update({"km": km if is_num(km) else None, "pricePerLiter": price if is_num(price) else None})
            items.append(Item(t.name, t.month, section, t.ref(r, hc + 1), str(text or "").strip() or section,
                              float(amt), date=d or f"{t.month}-01", note=note or (None if d else "sin fecha"),
                              counted=counted, extra=extra))
        r += 1
    # Una línea de extras que es el total de otra sección (='Argentina' = Q3) no se cuenta dos veces.
    for it in items:
        f = it.extra.get("formula") or ""
        if section == "extras" and re.fullmatch(r"=\$?[A-Z]+\$?\d+", f.replace(" ", "")):
            rr, cc = A1.search(f).group(2), A1.search(f).group(1)
            if int(rr) <= 4 and (int(rr), col_index(cc)) != (hr, hc + 1):
                it.counted = False
                it.note = f"es el total de otra sección ({f})"
    out.items.extend(items)
    if const:
        out.items.append(Item(t.name, t.month, section, t.ref(hr, hc + 1), f"{section} sin ticket", const,
                              date=f"{t.month}-01", note=f"constante en la fórmula del total ({total_f})"))
    summary_lines = sum(i.amount for i in items if not i.counted and (i.note or "").startswith("es el total"))
    ours = sum(i.amount for i in items if i.counted) + const + summary_lines
    if is_num(total_v):
        out.checks.append(Check(t.name, section, total_v, ours, cents(total_v) == cents(ours), source))
    elif isinstance(total_v, str) and "left" in total_v.lower():
        out.checks.append(Check(t.name, section, None, ours, True, "mes en curso en la hoja ('Left over')"))
    else:
        out.checks.append(Check(t.name, section, None, ours, True, f"sin total en la hoja; manda la {source}"))


def _block_list(t: Tab, out: Extraction, section: str, label: str, amount_col_offset: int):
    """Listas de efectivo y tarjeta: etiqueta con total a la derecha (o debajo en 'Efectivo')."""
    pos = t.find(label, rows=range(10, 25), cols=range(1, 6))
    if not pos:
        return
    r0, c0 = pos
    tot_f = t.f(r0, c0 + amount_col_offset)
    tot_v = t.v(r0, c0 + amount_col_offset)
    cells = referenced_cells(tot_f) or set()
    tc = c0  # el texto va en la columna de la etiqueta y el importe a su derecha
    items: list[Item] = []
    r, empty = r0 + 1, 0
    while r < r0 + 120 and empty < 4:
        text, amt = t.v(r, tc), t.v(r, tc + 1)
        if text is None and amt is None:
            empty += 1
            r += 1
            continue
        empty = 0
        if is_num(amt) and (not cells or (r, tc + 1) in cells):
            d, note = parse_date(text if isinstance(text, str) else None, t.month)
            items.append(Item(t.name, t.month, section, t.ref(r, tc + 1),
                              strip_date_prefix(str(text or "")) or section, float(amt),
                              date=d or f"{t.month}-01", note=note or (None if d else "sin fecha")))
        r += 1
    for it in items:
        if CARRY.match(it.text):
            it.counted = False
            it.note = "saldo del mes anterior (no es un movimiento)"
    out.items.extend(items)
    ours = sum(i.amount for i in items)
    note = ""
    if tot_f and "!" in tot_f:
        prev = out.prev_totals.get(section, 0.0)  # type: ignore[attr-defined]
        ours += prev
        note = f"incluye el saldo anterior ({prev:.2f})"
    if is_num(tot_v):
        out.prev_totals[section] = tot_v  # type: ignore[attr-defined]
        out.checks.append(Check(t.name, section, tot_v, ours, cents(tot_v) == cents(ours), note))


def _balances(t: Tab) -> dict:
    """Saldos que la hoja lleva por bolsa (para cuadrar cuentas): etiqueta en A, valor en C."""
    out = {}
    for r in range(10, 25):
        lab = t.v(r, 1)
        if isinstance(lab, str) and is_num(t.v(r, 3)):
            out[lab.strip()] = t.v(r, 3)
    return out


# =========================================================================== remanente

def _strip_today_ifs(expr: str) -> str:
    """IF(DATE(...)>TODAY(),0,X) -> (X). Estas fórmulas dependen del día en que se abre la hoja:
    hoy (2026) devuelven 0 para meses pasados. Lo que valían en su mes es X."""
    start_pat = re.compile(r"IF\(\s*DATE\(", re.I)
    pos = 0
    while True:
        m = start_pat.search(expr, pos)
        if not m:
            return expr
        depth, j = 1, m.end()          # cierra DATE( … ) aunque lleve paréntesis dentro
        while j < len(expr) and depth:
            depth += {"(": 1, ")": -1}.get(expr[j], 0)
            j += 1
        tail = re.match(r"\s*>\s*TODAY\(\)\s*,\s*0\s*,", expr[j:], re.I)
        if not tail:
            pos = m.end()
            continue
        k = j + tail.end()             # aquí empieza la rama «si no»: lo que valía en su mes
        depth, i = 1, k
        while i < len(expr) and depth:
            depth += {"(": 1, ")": -1}.get(expr[i], 0)
            i += 1
        inner = expr[k:i - 1].strip() or "0"
        expr = expr[:m.start()] + "(" + inner + ")" + expr[i:]


def eval_formula(formula: str, tab: Tab, tabs: dict, h_delta: dict) -> float | None:
    """Evalúa una fórmula aritmética sencilla de la hoja (sumas, restas, SUM de rangos y
    referencias a otras pestañas). `h_delta[pestaña]` corrige las celdas de la columna H
    (costes variables) de otra pestaña cuyo remanente estaba falseado por TODAY()."""
    expr = _strip_today_ifs(formula[1:])

    def other(m):
        t2 = tabs.get(m.group(1))
        if not t2:
            raise ValueError(m.group(1))
        c, r = col_index(m.group(2)), int(m.group(3))
        v = t2.v(r, c)
        v = v if is_num(v) else 0.0
        if c == 8:
            v += h_delta.get(t2.name, 0.0)
        return f"({v!r})"
    expr = re.sub(r"'([^']+)'!\$?([A-Z]{1,3})\$?(\d+)", other, expr)

    def rng(m):
        cells = referenced_cells("=" + m.group(0)) or set()
        return f"({sum(tab.v(r, c) for r, c in cells if is_num(tab.v(r, c)))!r})"
    expr = re.sub(r"SUM\(\s*\$?[A-Z]{1,3}\$?\d+\s*:\s*\$?[A-Z]{1,3}\$?\d+\s*\)", rng, expr, flags=re.I)

    def cell(m):
        v = tab.v(int(m.group(2)), col_index(m.group(1)))
        return f"({v if is_num(v) else 0.0!r})"
    expr = re.sub(r"\$?([A-Z]{1,3})\$?(\d+)", cell, expr)
    if not re.fullmatch(r"[0-9eE.+\-*/()\s]*", expr):
        return None
    try:
        return float(eval(expr or "0", {"__builtins__": {}}))  # solo números y operadores
    except Exception:
        return None


@dataclass
class Remain:
    month: str
    ref_delta: float         # (celda del mes anterior a la que apunta) − (su 'Total'): efectivo que sale del remanente
    cached: float        # lo que muestra la hoja hoy
    intended: float      # lo que valía en su mes
    formula: str | None
    total_cached: float  # 'Total' de costes variables
    total_intended: float
    jump: float          # intended - total del mes anterior: cambios a mano en el remanente
    artifact: bool       # la hoja enseña hoy otro valor por TODAY()


def remain_chain(tabs: list[Tab], until: str) -> list[Remain]:
    by_name = {t.name: t for t in tabs}
    h_delta: dict = {}
    out: list[Remain] = []
    prev_total = None
    for t in [x for x in tabs if x.month <= until]:
        rpos = t.find("remain", cols=range(1, 2), exact=False) or t.find("remaing", cols=range(1, 2), exact=False)
        tpos = t.find("total", cols=range(7, 8))
        cached = t.v(rpos[0], 3) if rpos else 0.0
        cached = cached if is_num(cached) else 0.0
        f = t.f(rpos[0], 3) if rpos else None
        intended = eval_formula(f, t, by_name, h_delta) if f else cached
        if intended is None:
            intended = cached
        h_delta[t.name] = intended - cached
        tc = t.v(tpos[0], 8) if tpos else 0.0
        tc = tc if is_num(tc) else 0.0
        ti = tc + (intended - cached)
        jump = 0.0 if prev_total is None else intended - prev_total
        ref_delta = 0.0
        m = re.search(r"'([^']+)'!\$?H\$?(\d+)", f or "")
        if m and prev_total is not None and m.group(1) in by_name:
            pt = by_name[m.group(1)]
            v = pt.v(int(m.group(2)), 8)
            if is_num(v):
                ref_delta = v + h_delta.get(pt.name, 0.0) - prev_total
        out.append(Remain(t.month, ref_delta, cached, intended, f, tc, ti, jump, cents(intended) != cents(cached)))
        prev_total = ti
    return out


# =========================================================================== plan (opción A)
# Todo el histórico va a cuentas archivadas propias, sin tocar las cuentas reales:
#   pool      «Excel (hasta feb-2026)»: tu remanente mes a mes (principal de cada época)
#   ahorro    «Excel: ahorros» (Saves, Invest, From saves)
#   mami      «Excel: Mami» (ingreso, cuota, préstamos y devoluciones)
#   efectivo  «Excel: efectivo» (lista de efectivo y cajeros)
POOL, SAVINGS, MAMI, CASH = "pool", "ahorro", "mami", "efectivo"
ROLES = (POOL, SAVINGS, MAMI, CASH)
CARD = "card"
SHEILA_FUEL = {"2024-12": (125.01, "Ingreso Sheila (mitad del combustible)")}


@dataclass
class Mov:
    kind: str                 # expense | income | transfer | settlement
    month: str                # pestaña de origen
    date: str
    amount: float             # siempre positivo
    description: str
    account: str              # rol (origen en transferencias)
    to: str | None = None
    category: str | None = None   # comida | gasolina | extra | ajuste
    transfer_kind: str = "normal"
    card: dict | None = None
    fuel: dict | None = None
    cell: str = ""
    note: str | None = None


@dataclass
class HistoryPlan:
    movs: list[Mov] = field(default_factory=list)
    initial: dict = field(default_factory=dict)
    remains: list[Remain] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def r2(v: float) -> float:
    """Céntimos, mitades hacia fuera (la hoja tiene importes como 28,535)."""
    c = int(abs(v) * 100 + 0.5 + 1e-9)
    return (-c if v < 0 else c) / 100


def _add(M: list, it: Item, account: str, category: str | None, desc: str | None = None, pos="expense", neg="income"):
    amt = r2(it.amount)
    if amt == 0:
        return None
    mv = Mov(pos if amt > 0 else neg, it.month, it.date or f"{it.month}-01", abs(amt), desc or it.text, account,
             category=category, cell=it.cell, note=it.note)
    M.append(mv)
    return mv


def _transfer(M: list, month: str, date_: str, amount: float, desc: str, src: str, dst: str, cell: str,
              kind: str = "normal", note: str | None = None):
    amt = r2(amount)
    if amt > 0:
        M.append(Mov("transfer", month, date_, amt, desc, src, to=dst, transfer_kind=kind, cell=cell, note=note))
    elif amt < 0:
        M.append(Mov("transfer", month, date_, -amt, desc, dst, to=src, transfer_kind=kind, cell=cell, note=note))


def cash_in_total(t: Tab) -> float:
    """Si el 'Total' de costes variables suma el efectivo (…+B17), cuánto suma."""
    tpos = t.find("total", cols=range(7, 8))
    f = t.f(tpos[0], 8) if tpos else None
    m = re.search(r"\+\$?([AB])\$?(\d+)\s*$", f or "")
    if not m:
        return 0.0
    r, c = int(m.group(2)), col_index(m.group(1))
    v = t.v(r, c)
    if not is_num(v):
        v = t.v(r, c + 1)
    return float(v) if is_num(v) else 0.0


def build_plan(tabs: list[Tab], ex: Extraction, until: str) -> HistoryPlan:
    plan = HistoryPlan()
    M = plan.movs
    tabs = [t for t in tabs if t.month <= until]
    by_month: dict[str, list[Item]] = {}
    for it in ex.items:
        by_month.setdefault(it.month, []).append(it)
    card_groups: dict[str, float] = {}
    card_paid: set = set()
    prev_prestado = 0.0
    prev_cash = 0.0
    plan.remains = remain_chain(tabs, until)
    rem = {r.month: r for r in plan.remains}

    for t in tabs:
        month, items = t.month, by_month.get(t.month, [])
        has_cash_list = any(i.section == "cash" for i in items)
        extras_atm = [i for i in items if i.section == "extras" and i.counted and i.text.lower().startswith("atm")]
        r = rem[month]
        manual = r.jump
        out_cash = 0.0
        if cents(prev_cash) and cents(r.ref_delta) == -cents(prev_cash):
            out_cash = -r.ref_delta      # arrastra una celda del mes anterior que ya no lleva el efectivo
        elif cents(prev_cash) and cents(r.jump) == -cents(prev_cash):
            out_cash = -r.jump           # o se lo resta a mano ('…'!H20-50)
        if out_cash:
            # El mes anterior sumó el efectivo al total; este mes arrastra el total sin él.
            _transfer(M, month, f"{month}-01", out_cash, "Efectivo fuera del remanente", POOL, CASH,
                      f"{t.name}!C(remain)", note=f"«Remain last month» = {r.formula}")
            manual = r.jump + out_cash
        if cents(manual):
            what = r.formula or "valor escrito a mano"
            M.append(Mov("income" if manual > 0 else "expense", month, f"{month}-01", abs(r2(manual)),
                         "Ajuste del remanente", POOL, category="ajuste", cell=f"{t.name}!C(remain)",
                         note=f"cambio a mano en «Remain last month»: {what}"))
        for it in items:
            if not it.counted:
                continue
            s, low = it.section, it.text.lower()
            if s == "salary":
                _add(M, it, POOL, None, "Nómina", pos="income", neg="expense")
            elif s == "fixed":
                _add(M, it, POOL, "extra")
            elif s == "savings":
                _transfer(M, month, it.date, it.amount, it.text, POOL, SAVINGS, it.cell)
            elif s == "extras" and low.startswith("atm"):
                if has_cash_list:
                    _transfer(M, month, it.date, it.amount, "Cajero", POOL, CASH, it.cell)
                else:
                    _add(M, it, POOL, "extra", "Retirada de efectivo")  # sin lista de efectivo: la hoja lo da por gastado
            elif s in ("food", "fuel", "argentina", "extras"):
                cat = {"food": "comida", "fuel": "gasolina"}.get(s, "extra")
                mv = _add(M, it, POOL, cat)
                if mv and s == "fuel":
                    mv.fuel = {"km": it.extra.get("km"), "pricePerLiter": it.extra.get("pricePerLiter")}
            elif s == "card":
                amt = r2(it.amount)
                charge = add_months(month, 1)
                M.append(Mov("expense", month, it.date, abs(amt), it.text, POOL, category="extra", cell=it.cell,
                             note=it.note, card={"cardId": CARD, "chargeMonth": charge, "reserveIn": "charge"}))
                card_groups[charge] = card_groups.get(charge, 0.0) + amt
            elif s == "cash":
                if low.startswith("atm"):
                    if not extras_atm:
                        _transfer(M, month, it.date, it.amount, "Cajero", CASH, POOL, it.cell)
                    continue
                _add(M, it, CASH, "extra", pos="income", neg="expense")
            elif s == "variable":
                f = it.extra.get("formula") or ""
                amt = r2(it.amount)
                if low == "tarjeta":
                    if amt == 0:
                        continue
                    if month in card_groups:
                        M.append(Mov("settlement", month, f"{month}-01", amt, "Pago de tarjeta", POOL,
                                     card={"cardId": CARD, "chargeMonth": month}, cell=it.cell))
                        card_paid.add(month)
                        if cents(card_groups[month]) != cents(amt):
                            plan.warnings.append(f"{month}: pagaste {amt:.2f} de tarjeta y las compras suman {card_groups[month]:.2f}.")
                    else:
                        M.append(Mov("expense", month, f"{month}-01", amt, "Tarjeta (sin detalle)", POOL, category="extra", cell=it.cell))
                elif low.startswith(("devolver mami", "dolver mami")):
                    _transfer(M, month, f"{month}-01", amt, "Devolución a Mami", POOL, MAMI, it.cell, kind="loanRepayment")
                elif low.startswith("ingreso mami"):
                    _add(M, it, MAMI, None, "Ingreso de Mami", pos="income", neg="expense")
                elif low.startswith(("cuota mami", "couta mami")):
                    _add(M, it, MAMI, "extra")
                elif low.startswith("prestado mami"):
                    carried = prev_prestado if "!" in f else 0.0
                    new = r2(amt - carried) if amt > 0 else amt
                    if amt > 0:
                        prev_prestado = amt
                    if new > 0:  # compras pagadas con dinero de Mami: préstamo y lo que financió
                        _transfer(M, month, f"{month}-01", new, "Préstamo de Mami", MAMI, POOL, it.cell, kind="loan")
                        M.append(Mov("expense", month, f"{month}-01", new, "Compras con el préstamo de Mami", POOL,
                                     category="extra", cell=it.cell))
                    elif new < 0:
                        _transfer(M, month, f"{month}-01", -new, "Préstamo de Mami", MAMI, POOL, it.cell, kind="loan")
                elif low.startswith(("from saves", "ahorros")):
                    _transfer(M, month, f"{month}-01", -amt, "Desde ahorros", SAVINGS, POOL, it.cell)
                else:
                    _add(M, it, POOL, "extra")
        if month in SHEILA_FUEL:
            amt, desc = SHEILA_FUEL[month]
            M.append(Mov("income", month, f"{month}-31" if month.endswith("12") else f"{month}-28", amt, desc, POOL,
                         category="gasolina", note="la hoja contaba la mitad del combustible"))
        cash = cash_in_total(t)
        prev_cash = cash
        if cents(cash):
            _transfer(M, month, last_day(month), cash, "Efectivo sumado al remanente", CASH, POOL,
                      f"{t.name}!Total", note="tu hoja suma el efectivo al remanente del mes")

    # Toda compra con tarjeta queda pagada: si la hoja no tiene la fila 'Tarjeta', se paga el día 1 del mes de cargo.
    for charge, total in sorted(card_groups.items()):
        if charge not in card_paid and cents(total):
            M.append(Mov("settlement", charge if charge <= until else until, f"{charge}-01", r2(total),
                         "Pago de tarjeta", POOL, card={"cardId": CARD, "chargeMonth": charge},
                         note="la hoja no tiene la fila 'Tarjeta' de ese mes"))
            plan.warnings.append(f"Cargo de tarjeta de {charge} sin fila 'Tarjeta' en la hoja: se da por pagado ({total:.2f}).")

    # La app agrupa por fecha y la hoja por pestaña: un gasto del 30-ene apuntado en la pestaña
    # de febrero cuenta en febrero. Se le pone el día 1 del mes de su pestaña y se guarda la fecha real.
    for m in M:
        if not m.card and m.kind != "settlement" and m.date[:7] != m.month:
            m.note = (m.note + "; " if m.note else "") + f"fecha real {m.date}"
            m.date = f"{m.month}-01"

    first = plan.remains[0] if plan.remains else None
    plan.initial = {POOL: r2(first.intended) if first else 0.0, SAVINGS: 0.0, MAMI: 0.0, CASH: 0.0}
    _reconcile(plan, tabs)
    return plan


def last_day(month: str) -> str:
    import calendar
    return f"{month}-{calendar.monthrange(int(month[:4]), int(month[5:]))[1]:02d}"


def flows(movs: list[Mov], account: str, month: str) -> float:
    """Efecto de los movimientos de un mes en el saldo de una cuenta (como realBalance)."""
    total = 0.0
    for m in movs:
        if m.date[:7] != month:
            continue
        if m.kind == "income" and m.account == account:
            total += m.amount
        elif m.kind == "expense" and m.account == account and not m.card:
            total -= m.amount
        elif m.kind == "settlement" and m.account == account:
            total -= m.amount
        elif m.kind == "transfer":
            if m.account == account:
                total -= m.amount
            if m.to == account:
                total += m.amount
    return total


def _reconcile(plan: HistoryPlan, tabs: list[Tab]):
    """Cuadre: el saldo de la cuenta «Excel» al final de cada mes = 'Total' de costes variables de la hoja."""
    bal = plan.initial[POOL]
    for t, r in zip(tabs, plan.remains):
        bal += flows(plan.movs, POOL, t.month)
        gap = cents(r.total_intended) - cents(bal)
        if gap and abs(gap) <= 3:
            # La hoja guarda fracciones de céntimo (28,535 €); la app, céntimos.
            plan.movs.append(Mov("income" if gap > 0 else "expense", t.month, last_day(t.month), abs(gap) / 100,
                                 "Redondeo de céntimos", POOL, category="ajuste", note="la hoja usa fracciones de céntimo"))
            bal += gap / 100
        plan.checks.append(Check(t.name, "remanente", r2(r.total_intended), r2(bal), cents(bal) == cents(r.total_intended),
                                 "la hoja muestra hoy otro valor por TODAY()" if r.artifact else ""))


# =========================================================================== documentos Firestore

HIST_ACCOUNTS = {
    POOL: ("hist_excel", "Excel (hasta feb-2026)"),
    SAVINGS: ("hist_excel_ahorros", "Excel: ahorros"),
    MAMI: ("hist_excel_mami", "Excel: Mami"),
    CASH: ("hist_excel_efectivo", "Excel: efectivo"),
}
HIST_CARD = "hist_excel_card"
CATEGORY_NAMES = {"comida": ["comida", "food"], "gasolina": ["gasolina", "combustible", "fuel"],
                  "extra": ["extra", "extras"], "ajuste": ["ajuste", "ajustes"]}


def _norm(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").strip().lower()) if unicodedata.category(c) != "Mn")


def history_docs(plan: HistoryPlan, categories: dict) -> dict:
    """Documentos del histórico para users/{uid}/…  `categories` = {id: doc} ya planificados.
    Todo lleva source='history' y vive en cuentas archivadas propias: ninguna cuenta real cambia."""
    out = {"accounts": {}, "cards": {}, "categories": {}, "movements": {}, "cardSettlements": {}}
    by_name = {_norm(c.get("name", "")): cid for cid, c in categories.items()}
    cat_id = {}
    for key, names in CATEGORY_NAMES.items():
        found = next((by_name[n] for n in names if n in by_name), None)
        if not found:
            found = f"hist_cat_{key}"
            out["categories"][found] = {"name": key.capitalize(), "archived": False, "order": 900,
                                        "createdAt": None, "source": "history"}
        cat_id[key] = found

    for role, (aid, name) in HIST_ACCOUNTS.items():
        out["accounts"][aid] = {"name": name, "bankName": "Histórico", "initialBalance": plan.initial.get(role, 0.0),
                                "archived": True, "order": 1000, "createdAt": None, "source": "history"}
    out["cards"][HIST_CARD] = {"name": "Tarjeta (Excel)", "accountId": HIST_ACCOUNTS[POOL][0], "cutoffDay": None,
                               "chargeOffsetMonths": 1, "defaultReserveIn": "charge", "archived": True,
                               "createdAt": None, "source": "history"}
    acc = {role: aid for role, (aid, _) in HIST_ACCOUNTS.items()}
    seq: dict = {}
    for m in plan.movs:
        hist = {"cell": m.cell, **({"note": m.note} if m.note else {})}
        if m.kind == "settlement":
            sid = f"{HIST_CARD}_{m.card['chargeMonth']}"
            out["cardSettlements"][sid] = {"cardId": HIST_CARD, "accountId": acc[m.account],
                                           "chargeMonth": m.card["chargeMonth"], "date": m.date, "amount": m.amount,
                                           "createdAt": None, "source": "history", "history": hist}
            continue
        n = seq[m.month] = seq.get(m.month, 0) + 1
        mid = f"hist_{m.month.replace('-', '')}_{n:04d}"
        doc = {"type": m.kind, "date": m.date, "amount": m.amount, "description": m.description,
               "accountId": acc[m.account], "createdAt": None, "source": "history", "history": hist}
        if m.kind in ("expense", "income"):
            doc["categoryId"] = cat_id[m.category] if m.category else None
        if m.kind == "transfer":
            doc["toAccountId"] = acc[m.to]
            doc["transferKind"] = m.transfer_kind
            if m.transfer_kind == "loan":
                doc["loan"] = {"status": "paid", "outstanding": 0.0}  # devueltos dentro del histórico
        if m.card:
            doc["card"] = {"cardId": HIST_CARD, "chargeMonth": m.card["chargeMonth"],
                           "reserveIn": "charge" if m.card.get("reserveIn") == "charge" else "purchase"}
        if m.fuel and (m.fuel.get("km") or m.fuel.get("pricePerLiter")):
            doc["fuel"] = {"km": m.fuel.get("km"), "pricePerLiter": m.fuel.get("pricePerLiter")}
        out["movements"][mid] = doc
    return out


def report_lines(ex: Extraction, plan: HistoryPlan) -> list[str]:
    """Resumen legible para la terminal."""
    L = []
    sec = [c for c in ex.checks]
    L.append(f"Secciones de la hoja (comida, extras, combustible, Argentina, tarjeta, efectivo): "
             f"{sum(c.ok for c in sec)} de {len(sec)} cuadran al céntimo con sus totales.")
    for c in sec:
        if not c.ok:
            L.append(f"   ✖ {c.tab} · {c.what}: hoja {c.sheet} · importado {c.ours:.2f}")
    rc = plan.checks
    L.append(f"Remanente mes a mes («Total» de costes variables): {sum(c.ok for c in rc)} de {len(rc)} meses al céntimo.")
    for c in rc:
        if not c.ok:
            L.append(f"   ✖ {c.tab}: hoja {c.sheet} · cuenta Excel {c.ours}")
    arts = [r for r in plan.remains if r.artifact]
    if arts:
        L.append("Remanentes que tu hoja enseña HOY con otro valor por usar TODAY() en la fórmula:")
        for r in arts:
            L.append(f"   · {r.month}: hoy {r.cached:.2f}, en su mes {r.intended:.2f}")
    aj = [m for m in plan.movs if m.category == "ajuste"]
    L.append(f"Ajustes: {len(aj)} (total {sum(m.amount if m.kind == 'income' else -m.amount for m in aj):+.2f} €)")
    for m in aj:
        L.append(f"   · {m.month} {'+' if m.kind == 'income' else '-'}{m.amount:.2f}  {m.description} — {m.note or ''}")
    from collections import Counter
    k = Counter(m.kind for m in plan.movs)
    L.append(f"Movimientos: {len(plan.movs)} ({k['expense']} gastos, {k['income']} ingresos, "
             f"{k['transfer']} transferencias, {k['settlement']} pagos de tarjeta)")
    for w in ex.warnings + plan.warnings:
        L.append(f"   ⚠ {w}")
    fixes = [i for i in ex.items if i.note and "fuera de la pestaña" in i.note]
    if fixes:
        L.append(f"Fechas corregidas al día 1 del mes (erratas): {len(fixes)}")
        for i in fixes:
            L.append(f"   · {i.cell}: {i.note}")
    return L
