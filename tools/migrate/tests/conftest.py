import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Clon del repo Salary viejo para comparar con su motor de cálculo.
LEGACY_PATH = os.environ.get("SALARY_LEGACY_PATH", str(Path.home() / "salary-ro"))


@pytest.fixture(scope="session")
def FinanceCore():
    if not (Path(LEGACY_PATH) / "services" / "finance_core.py").exists():
        pytest.skip(f"Motor viejo no encontrado en {LEGACY_PATH} (define SALARY_LEGACY_PATH)")
    from salary_migrate.verify import load_engine
    return load_engine(LEGACY_PATH)


@pytest.fixture
def legacy_path():
    return LEGACY_PATH
