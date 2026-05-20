"""
Case router — determines the routing basket based on missing document count.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

from models.schemas import AuditEvent, Basket, Case, ChecklistItem, DocumentStatus, EventType


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_tech_commercialization(case: Case, scenario_folder: str) -> bool:
    """Check if this is a technology commercialization project."""
    # Check checklist first (DOC-08 not_applicable means it's non-tech)
    for item in case.checklist:
        if item.doc_id == "DOC-08" and item.status == DocumentStatus.not_applicable:
            return False

    # Try reading app form directly
    folder = Path(scenario_folder)
    app_form = folder / "application_form.json"
    if app_form.exists():
        try:
            with open(app_form, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            project = data.get("project", {})
            return bool(project.get("technology_commercialization", False))
        except Exception:
            pass

    # Fall back to checking documents list
    for doc in case.documents:
        if doc.detected_doc_type == "DOC-01":
            path = folder / doc.name
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as fh:
                        data = json.load(fh)
                    project = data.get("project", {})
                    val = project.get("technology_commercialization", False)
                    if isinstance(val, dict):
                        return bool(val.get("value", False))
                    return bool(val)
                except Exception:
                    pass
    return False


def route_case(case: Case, scenario_folder: str = "") -> Case:
    """
    Determine the routing basket and update the case accordingly.

    Basket logic:
      - missing_count == 0 → complete
      - missing_count 1-2 → incomplete
      - missing_count 3+  → decline_basket

    DOC-03 with status "uncertain" counts as missing.
    DOC-08 counts as missing only if tech_commercialization=True.

    Returns updated Case.
    """
    tech_comm = _is_tech_commercialization(case, scenario_folder)

    missing_count = 0
    missing_categories: List[str] = []

    for item in case.checklist:
        if item.doc_id == "DOC-08":
            if not tech_comm:
                # DOC-08 is not applicable for non-tech projects
                continue
        # Count missing and uncertain as gaps
        if item.status in (DocumentStatus.missing, DocumentStatus.uncertain):
            missing_count += 1
            missing_categories.append(item.doc_id)

    # Determine basket
    if missing_count == 0:
        basket = Basket.complete
    elif missing_count <= 2:
        basket = Basket.incomplete
    else:
        basket = Basket.decline_basket

    case.basket = basket
    case.missing_count = missing_count
    case.missing_categories = missing_categories
    case.status = "routed"

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.basket_assigned,
        actor="system",
        details={
            "basket": basket.value,
            "missing_count": missing_count,
            "missing_categories": missing_categories,
            "tech_commercialization": tech_comm,
        },
    )
    case.audit_trail.append(audit)
    return case
