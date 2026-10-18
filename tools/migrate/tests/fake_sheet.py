"""
Hoja de cálculo falsa con la estructura del Excel mensual (datos inventados).
Cada celda tiene su valor calculado y, si la tiene, su fórmula: así se prueba el
importador sin Excel ni datos reales. Los valores se han calculado a mano.
"""
import re

from salary_migrate.history import Tab, col_index


class _Cell:
    def __init__(self, value):
        self.value = value


class FakeWS:
    def __init__(self, cells: dict):
        self.cells = {}
        for ref, v in cells.items():
            m = re.match(r"([A-Z]+)(\d+)$", ref)
            self.cells[(int(m.group(2)), col_index(m.group(1)))] = v

    def cell(self, r, c):
        return _Cell(self.cells.get((r, c)))


def tab(name: str, cells: dict) -> Tab:
    """cells: {'C4': (valor, '=fórmula')} o {'A1': valor}."""
    values = {k: (v[0] if isinstance(v, tuple) else v) for k, v in cells.items()}
    formulas = {k: (v[1] if isinstance(v, tuple) else v) for k, v in cells.items()}
    return Tab(name, FakeWS(values), FakeWS(formulas))


def january():
    return tab("January 26", {
        "A1": "Salary", "B1": "January",
        "A2": "Salary", "C2": 2000.0, "A3": "Extras", "C3": 0.0,
        "A4": "Brutto", "C4": (2000.0, "=SUM(C2:C3)"),
        "A5": "Cont.Comu", "B5": 0.1, "C5": (200.0, "=$C$4*$B5"),
        # Remanente que depende de TODAY(): hoy da 0, en su mes valía 100.
        "A11": "Remain last month", "C11": (0, "=IF(DATE(YEAR(TODAY()),C1-1,30)>TODAY(),0,100)"),
        "A12": "Total", "C12": (1800.0, "=C4-SUM(C5:C10)+C11"),
        "E2": "Fixed costs",
        "D3": "01.01.2026", "E3": "Rent", "F3": 900.0,
        "E4": "Fuel", "F4": (60.0, "=Q3"),
        "E5": "Food", "F5": (45.5, "=K3"),
        "E6": "Saves", "F6": 100.0,
        "E7": "Total", "F7": (694.5, "=$C$12-SUM($F$3:$F$6)"),
        "G2": "Variables cost",
        "G3": "Salary", "H3": (694.5, "=F7"),
        "G4": "Extras", "H4": (30.0, "=$N$3"),
        "G5": "Tarjeta", "H5": 0.0,
        "G7": "Ingreso Mami", "H7": 500.0,
        "G8": "Cuota Mami 1/12", "H8": 400.0,
        "G9": "Prestado mami", "H9": (30.0, "=20+10"),
        "G19": "Total", "H19": (699.5, "=$H$3-SUM($H$4:$H$6)+B17"),
        "J3": "Food", "K3": (45.5, "=SUM(K4:K1007)"),
        "I4": "02.01.2026", "J4": "Mercadona", "K4": 30.25,
        "J5": "Pan", "K5": 15.25,
        "M3": "Extras", "N3": (30.0, "=SUM(N4:N1007)"),
        "L4": "03.01.2026", "M4": "Cine", "N4": 40.0,
        "L5": "05.01.2026", "M5": "Nacho", "N5": -60.0,
        "L6": "06.01.2026", "M6": "ATM", "N6": 50.0,
        "P3": "Fuel", "Q3": (60.0, "=SUM(Q4:Q4)"),
        "O4": "07.01.2026", "P4": "Repsol", "Q4": 60.0, "R4": 600.0, "U4": 1.5,
        "O5": "15.01.2026", "P5": "Shell", "Q5": 55.0, "R5": 500.0, "U5": 1.5,   # registro de km: no suma
        "A17": "Efectivo", "B17": (35.0, "=SUM(B18:B30)"),
        "A18": "ATM", "B18": 50.0, "A19": "Ana", "B19": 20.0, "A20": "Super", "B20": -35.0,
        "D17": "Card Next Month", "E17": (30.0, "=SUM(E18:E30)"),
        "D18": "10.01 - Cena", "E18": 30.0,
    })


def february():
    return tab("February 26", {
        "A1": "Salary", "B1": "February",
        "A2": "Salary", "C2": 2000.0, "A3": "Extras", "C3": 0.0,
        "A4": "Brutto", "C4": (2000.0, "=SUM(C2:C3)"),
        "A5": "Cont.Comu", "B5": 0.1, "C5": (200.0, "=$C$4*$B5"),
        # Arrastra el total de enero y le resta a mano el efectivo que enero había sumado.
        "A11": "Remain last month", "C11": (664.5, "='January 26'!H19-35"),
        "A12": "Total", "C12": (2464.5, "=C4-SUM(C5:C10)+C11"),
        "E2": "Fixed costs",
        "D3": "01.02.2026", "E3": "Rent", "F3": 900.0,
        "E4": "Fuel", "F4": 0.0,
        "E5": "Food", "F5": (10.0, "=K3"),
        "E6": "Saves", "F6": 0.0,
        "E7": "Total", "F7": (1554.5, "=$C$12-SUM($F$3:$F$6)"),
        "G2": "Variables cost",
        "G3": "Salary", "H3": (1554.5, "=F7"),
        "G4": "Extras", "H4": (0.0, "=$N$3"),
        "G5": "Tarjeta", "H5": (30.0, "='January 26'!E17"),
        "G6": "Devolver mami", "H6": (30.0, "='January 26'!H9"),
        "G9": "Prestado mami", "H9": (35.0, "='January 26'!H9+5"),
        "G19": "Total", "H19": (1494.5, "=$H$3-SUM($H$4:$H$6)"),
        "J3": "Food", "K3": (10.0, "=SUM(K4:K1007)"),
        "I4": "30.01.2026", "J4": "Pan", "K4": 10.0,
        "M3": "Extras", "N3": (0.0, "=SUM(N4:N1007)"),
        "P3": "Fuel", "Q3": 0.0,
        "A17": "Efectivo", "B17": (0.0, "=SUM(B18:B30)"),
        "A18": "Last month", "B18": 35.0, "A19": "Super", "B19": -35.0,
        "D17": "Card Next Month", "E17": (0.0, "=SUM(E18:E30)"),
    })


def workbook():
    return [january(), february()]
