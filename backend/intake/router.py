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


def _route_case_legacy(case: Case, scenario_folder: str = "") -> Case:
    """
    DEACTIVATED by default — retained as the no-key fallback.

    Deterministic basket assignment from missing document count.
    Runs only when no model key is configured (see route_case dispatcher).

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
            "engine": "rules-legacy",
            "basket": basket.value,
            "missing_count": missing_count,
            "missing_categories": missing_categories,
            "tech_commercialization": tech_comm,
        },
    )
    case.audit_trail.append(audit)
    return case


# ===========================================================================
# MODEL / SKILL-BASED routing (default path when a key is configured)
# ===========================================================================

def _route_case_llm(case: Case, scenario_folder: str = "") -> Case:
    """
    Model-decided basket assignment guided by documents.json routing rules.

    The model receives the LLM-produced completeness checklist and findings
    and decides: complete / incomplete / decline_basket along with the list
    of missing doc IDs.  Raises on failure so the dispatcher can fall back.
    """
    import json
    from pathlib import Path
    from intake import llm

    docs_skill_file = Path(__file__).parent / "documents.json"
    routing_rules: dict = {}
    try:
        with open(docs_skill_file, "r", encoding="utf-8") as fh:
            routing_rules = json.load(fh).get("routing_rules", {})
    except Exception:
        pass

    checklist_payload = [
        {"doc_id": c.doc_id, "category": c.category, "status": c.status.value}
        for c in case.checklist
    ]
    findings_payload = [
        {"rule_id": f.rule_id, "severity": f.severity.value, "message": f.message}
        for f in case.findings
    ]

    system_msg = (
        "You are a precise case router for grant applications. "
        "Decide the routing basket and identify missing documents. "
        "Return only the specified JSON — no prose."
    )
    user_msg = (
        "ROUTING RULES (authoritative — apply exactly):\n"
        f"{json.dumps(routing_rules, indent=2)}\n\n"
        "COMPLETENESS CHECKLIST:\n"
        f"{json.dumps(checklist_payload, indent=2)}\n\n"
        "FINDINGS FROM RULES EVALUATION:\n"
        f"{json.dumps(findings_payload, indent=2)}\n\n"
        "Return ONLY this JSON object:\n"
        "{\n"
        '  "basket": <"complete" | "incomplete" | "decline_basket">,\n'
        '  "missing_count": <integer — number of missing/uncertain required docs>,\n'
        '  "missing_categories": [<"DOC-0X", ...>],\n'
        '  "reasoning": <one sentence explaining the basket decision>\n'
        "}\n"
        "Count DOC-08 as a gap ONLY if it appears in the checklist with status "
        "'missing' or 'uncertain' (i.e. the project IS tech-commercialization)."
    )

    result = llm.chat_json(system_msg, user_msg, max_tokens=300)
    if not result or "basket" not in result:
        raise RuntimeError("LLM routing returned no usable result")

    basket_map = {
        "complete": Basket.complete,
        "incomplete": Basket.incomplete,
        "decline_basket": Basket.decline_basket,
    }
    basket = basket_map.get(str(result.get("basket")), Basket.incomplete)
    missing_count = int(result.get("missing_count", 0))
    missing_categories: List[str] = result.get("missing_categories", []) or []

    # Validate the model's basket against its own stated missing_count.
    # The routing thresholds are exact numerical rules; correct any contradiction.
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

    case.audit_trail.append(AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.basket_assigned,
        actor="system",
        details={
            "engine": "model",
            "basket": basket.value,
            "missing_count": missing_count,
            "missing_categories": missing_categories,
            "reasoning": result.get("reasoning", ""),
        },
    ))
    return case


def route_case(case: Case, scenario_folder: str = "") -> Case:
    """
    Dispatcher: model/skill-based routing when a key is configured,
    otherwise the (dormant) legacy deterministic router as a safety net.
    """
    from intake import llm
    if llm.gpt_available():
        try:
            return _route_case_llm(case, scenario_folder)
        except Exception:
            return _route_case_legacy(case, scenario_folder)
    return _route_case_legacy(case, scenario_folder)
