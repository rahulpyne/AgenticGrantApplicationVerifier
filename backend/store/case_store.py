"""
JSON-backed persistent case store.
Cases are stored as individual JSON files under
/Users/rahulpyne/pacifican/rdii-prototype/store/cases/{case_id}.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List

from models.schemas import Case

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
import os as _os
STORE_ROOT = Path(_os.environ.get("STORE_DIR", str(Path(__file__).parent.parent.parent / "store")))
CASES_DIR = STORE_ROOT / "cases"
MANAGER_QUEUE_FILE = STORE_ROOT / "manager_queue.json"


def _ensure_dirs() -> None:
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    STORE_ROOT.mkdir(parents=True, exist_ok=True)


def _case_path(case_id: str) -> Path:
    return CASES_DIR / f"{case_id}.json"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def save_case(case: Case) -> None:
    """Serialize and write case to disk (create or overwrite)."""
    _ensure_dirs()
    path = _case_path(case.case_id)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(case.model_dump_json(indent=2))


def load_case(case_id: str) -> Case:
    """Read and deserialize a case. Raises FileNotFoundError if not found."""
    _ensure_dirs()
    path = _case_path(case_id)
    if not path.exists():
        raise FileNotFoundError(f"Case {case_id!r} not found")
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return Case.model_validate(data)


def list_cases() -> List[Case]:
    """Load all cases from disk, sorted by submission_timestamp descending."""
    _ensure_dirs()
    cases: List[Case] = []
    for json_file in sorted(CASES_DIR.glob("*.json")):
        try:
            with open(json_file, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            cases.append(Case.model_validate(data))
        except Exception:
            pass
    cases.sort(key=lambda c: c.submission_timestamp, reverse=True)
    return cases


def case_exists(case_id: str) -> bool:
    """Return True if the case file exists on disk."""
    _ensure_dirs()
    return _case_path(case_id).exists()
