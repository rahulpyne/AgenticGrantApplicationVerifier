"""
Case creation trigger.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from models.schemas import AuditEvent, Case, EventType
from store import case_store


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_case(scenario_folder: str, case_id: Optional[str] = None) -> Case:
    """
    Create and persist a new Case from a scenario folder path.

    Args:
        scenario_folder: Absolute (or resolvable) path to the submission folder.
        case_id:         Optional explicit case ID; generated if not provided.

    Returns:
        The newly created Case.
    """
    if case_id is None:
        suffix = str(uuid.uuid4()).replace("-", "")[:8].upper()
        case_id = f"RDII-2026-{suffix}"

    now = _now_iso()

    audit_event = AuditEvent(
        case_id=case_id,
        timestamp=now,
        event_type=EventType.case_created,
        actor="system",
        details={
            "scenario_folder": scenario_folder,
            "folder_name": Path(scenario_folder).name,
        },
    )

    case = Case(
        case_id=case_id,
        submission_timestamp=now,
        status="intake_pending",
        scenario_folder=scenario_folder,
        audit_trail=[audit_event],
    )

    case_store.save_case(case)
    return case
