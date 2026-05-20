"""
Manager queue — stores cases that require manager confirmation before a decline notice.

GUARDRAIL: Manager decisions are recorded here but NO notices are sent automatically.
All programme decisions remain with humans.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from models.schemas import AuditEvent, Case, EventType

import os as _os
STORE_ROOT = Path(_os.environ.get("STORE_DIR", str(Path(__file__).parent.parent.parent / "store")))
QUEUE_FILE = STORE_ROOT / "manager_queue.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_queue_file() -> None:
    STORE_ROOT.mkdir(parents=True, exist_ok=True)
    if not QUEUE_FILE.exists():
        QUEUE_FILE.write_text("[]", encoding="utf-8")


def add_to_manager_queue(case: Case) -> Case:
    """
    Add a case to the manager queue JSON file.

    Args:
        case: Case in the 'decline_basket'.

    Returns:
        Updated case with audit event appended.
    """
    _ensure_queue_file()

    with open(QUEUE_FILE, "r", encoding="utf-8") as fh:
        queue: List[Dict] = json.load(fh)

    # Check for existing entry
    existing_ids = {entry.get("case_id") for entry in queue}
    if case.case_id not in existing_ids:
        queue.append({
            "case_id": case.case_id,
            "added_at": _now_iso(),
            "basket": case.basket.value if case.basket else "decline_basket",
            "missing_count": case.missing_count,
            "missing_categories": case.missing_categories,
            "applicant_name": (
                case.extracted_fields.get("DF-01").value
                if case.extracted_fields.get("DF-01") else None
            ),
        })

        with open(QUEUE_FILE, "w", encoding="utf-8") as fh:
            json.dump(queue, fh, indent=2, default=str)

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.manager_queue_added,
        actor="system",
        details={
            "queue_file": str(QUEUE_FILE),
            "missing_count": case.missing_count,
        },
    )
    case.audit_trail.append(audit)
    case.status = "manager_pending"
    return case


def get_manager_queue() -> List[Dict]:
    """Return all entries in the manager queue."""
    _ensure_queue_file()
    with open(QUEUE_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def get_manager_queue_ids() -> List[str]:
    """Return just the case IDs in the manager queue."""
    return [entry.get("case_id", "") for entry in get_manager_queue()]


def remove_from_manager_queue(case_id: str) -> bool:
    """Remove a case from the queue. Returns True if it was present."""
    _ensure_queue_file()
    with open(QUEUE_FILE, "r", encoding="utf-8") as fh:
        queue: List[Dict] = json.load(fh)
    new_queue = [e for e in queue if e.get("case_id") != case_id]
    if len(new_queue) == len(queue):
        return False
    with open(QUEUE_FILE, "w", encoding="utf-8") as fh:
        json.dump(new_queue, fh, indent=2, default=str)
    return True
