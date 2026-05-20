"""
Document classifier — maps DocumentRecord objects to DOC-01 through DOC-08.
Uses filename heuristics first, then content signatures where possible.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from models.schemas import AuditEvent, Case, ChecklistItem, DocumentRecord, DocumentStatus, EventType

# ---------------------------------------------------------------------------
# Checklist catalogue
# ---------------------------------------------------------------------------
CHECKLIST_CATALOGUE = {
    "DOC-01": "Application Form (JSON)",
    "DOC-02": "Annual Financial Statements",
    "DOC-03": "Interim Financial Statements",
    "DOC-04": "Budget Worksheet (XLSX)",
    "DOC-05": "Business Plan / Pitch Deck",
    "DOC-06": "Funding Confirmation Letter",
    "DOC-07": "RDII Mandatory Supplemental Form",
    "DOC-08": "RDII Technology Questionnaire",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stem(name: str) -> str:
    """Return the lowercase filename stem with separators normalised to spaces."""
    stem = Path(name).stem.lower()
    return re.sub(r"[_\-\s]+", " ", stem).strip()


def _classify_one(
    record: DocumentRecord,
    scenario_folder: str,
    already_assigned: dict[str, list[DocumentRecord]],
) -> Tuple[Optional[str], float, str, Optional[str]]:
    """
    Return (detected_doc_type, confidence, matched_on, notes).
    already_assigned maps doc_type → list of DocumentRecord already mapped to it.
    """
    name_lower = record.name.lower()
    stem = _stem(record.name)
    ext = record.extension.lower()
    file_path = Path(scenario_folder) / record.name
    notes: Optional[str] = None

    # ------------------------------------------------------------------
    # DOC-01: Application form
    # ------------------------------------------------------------------
    if ext == ".json":
        # Try content check
        try:
            with open(file_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if "case_id" in data:
                return "DOC-01", 0.98, "content", None
        except Exception:
            pass
        if "application" in stem or "application form" in stem:
            return "DOC-01", 0.95, "filename", None
        return "DOC-01", 0.80, "filename", None

    # ------------------------------------------------------------------
    # DOC-03: Interim financials (must check BEFORE DOC-02)
    # ------------------------------------------------------------------
    if "interim" in stem:
        return "DOC-03", 0.90, "filename", None

    # ------------------------------------------------------------------
    # DOC-08: Technology questionnaire
    # ------------------------------------------------------------------
    if (
        "tech q" in stem
        or "technology questionnaire" in stem
        or "techq" in stem
        or ("tech" in stem and ("quest" in stem or "questionnaire" in stem))
    ):
        return "DOC-08", 0.90, "filename", None

    # ------------------------------------------------------------------
    # DOC-02: Annual financial statements
    # ------------------------------------------------------------------
    is_financial = (
        "financial statement" in stem
        or "financial statements" in stem
        or ("financials" in stem and "interim" not in stem)
    )
    if is_financial:
        # TC-12 duplicate/ambiguous: if a file named "financials_YYYY.pdf" is found
        # AND there is already a DOC-02 mapped
        ambiguous_year = re.search(r"\bfinancials[ _]20\d{2}\b", name_lower)
        if ambiguous_year and "DOC-02" in already_assigned and already_assigned["DOC-02"]:
            notes = (
                "Uncertain — possible duplicate or second year of annual statements. "
                "Manual disambiguation required."
            )
            return "uncertain_financial", 0.55, "filename", notes

        # Straightforward financial statement
        conf = 0.85
        if re.search(r"\b(annual|year.?end|20\d{2})\b", stem):
            conf = 0.85
        elif "financials" in stem and not re.search(r"\b20\d{2}\b", stem):
            conf = 0.75
        return "DOC-02", conf, "filename", None

    # ------------------------------------------------------------------
    # DOC-04: Budget worksheet
    # ------------------------------------------------------------------
    if "budget" in stem:
        if ext == ".xlsx":
            # Try reading tab names for content confirmation
            try:
                import openpyxl
                wb = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
                if "Cost Detail" in wb.sheetnames:
                    return "DOC-04", 0.95, "content", None
                return "DOC-04", 0.90, "filename", None
            except Exception:
                pass
        return "DOC-04", 0.90, "filename", None

    if ext in {".xlsx", ".xls"}:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
            if "Cost Detail" in wb.sheetnames:
                return "DOC-04", 0.95, "content", None
        except Exception:
            pass
        return "DOC-04", 0.90, "filename", None

    # ------------------------------------------------------------------
    # DOC-05: Business plan / pitch deck
    # ------------------------------------------------------------------
    if "business plan" in stem or "business_plan" in stem:
        return "DOC-05", 0.90, "filename", None
    if "pitch" in stem:
        return "DOC-05", 0.90, "filename", None
    if "business" in stem and "plan" in stem:
        return "DOC-05", 0.80, "filename", None

    # ------------------------------------------------------------------
    # DOC-06: Funding confirmation
    # ------------------------------------------------------------------
    if "funding confirmation" in stem or "funding_confirmation" in stem:
        return "DOC-06", 0.85, "filename", None
    if "confirmation" in stem:
        return "DOC-06", 0.85, "filename", None

    # ------------------------------------------------------------------
    # DOC-07: Supplemental form
    # ------------------------------------------------------------------
    if "supplemental" in stem:
        return "DOC-07", 0.90, "filename", None

    # Could not classify
    return None, 0.0, "filename", None


def _build_checklist(
    classified: list[DocumentRecord],
    tech_commercialization: bool,
) -> list[ChecklistItem]:
    """
    Build the 7 or 8 checklist items based on classification results.
    """
    checklist: list[ChecklistItem] = []
    required_docs = list(CHECKLIST_CATALOGUE.keys())
    if not tech_commercialization:
        required_docs = [d for d in required_docs if d != "DOC-08"]

    # Group records by doc_type
    by_type: dict[str, list[DocumentRecord]] = {}
    for doc in classified:
        dt = doc.detected_doc_type
        if dt:
            by_type.setdefault(dt, []).append(doc)

    for doc_id in required_docs:
        category = CHECKLIST_CATALOGUE[doc_id]
        matched = by_type.get(doc_id, [])

        if matched:
            # Use the highest-confidence match
            best = max(matched, key=lambda d: d.confidence)
            if best.confidence >= 0.70:
                status = DocumentStatus.present
            else:
                status = DocumentStatus.uncertain
            checklist.append(ChecklistItem(
                doc_id=doc_id,
                category=category,
                status=status,
                matched_files=[r.name for r in matched],
                confidence=best.confidence,
                notes=best.notes,
            ))
        else:
            # Check for uncertain_financial that might be DOC-03
            if doc_id == "DOC-03":
                uncertain_fin = by_type.get("uncertain_financial", [])
                if uncertain_fin:
                    best = uncertain_fin[0]
                    checklist.append(ChecklistItem(
                        doc_id=doc_id,
                        category=category,
                        status=DocumentStatus.uncertain,
                        matched_files=[r.name for r in uncertain_fin],
                        confidence=best.confidence,
                        notes=best.notes,
                    ))
                    continue

            checklist.append(ChecklistItem(
                doc_id=doc_id,
                category=category,
                status=DocumentStatus.missing,
                matched_files=[],
                confidence=0.0,
            ))

    # DOC-08 if tech_commercialization is False — add as not_applicable
    if not tech_commercialization:
        checklist.append(ChecklistItem(
            doc_id="DOC-08",
            category=CHECKLIST_CATALOGUE["DOC-08"],
            status=DocumentStatus.not_applicable,
            matched_files=[],
            confidence=0.0,
        ))

    return checklist


def classify_documents(case: Case, scenario_folder: str) -> Case:
    """
    Classify each DocumentRecord and build the checklist.

    Args:
        case:            Current Case (with documents populated by ingestion).
        scenario_folder: Absolute path to the submission folder.

    Returns:
        Updated Case with documents classified and checklist built.
    """
    already_assigned: dict[str, list[DocumentRecord]] = {}
    classified: list[DocumentRecord] = []

    for record in case.documents:
        doc_type, confidence, matched_on, notes = _classify_one(
            record, scenario_folder, already_assigned
        )
        updated = record.model_copy(update={
            "detected_doc_type": doc_type,
            "confidence": confidence,
            "matched_on": matched_on,
            "parse_status": "parsed" if doc_type else "unclassified",
            "notes": notes,
        })
        classified.append(updated)
        if doc_type:
            already_assigned.setdefault(doc_type, []).append(updated)

    case.documents = classified

    # Determine if technology commercialization applies
    tech_comm = _is_tech_commercialization(case, scenario_folder)

    case.checklist = _build_checklist(classified, tech_comm)

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.classification_completed,
        actor="system",
        details={
            "classified_count": sum(1 for d in classified if d.detected_doc_type),
            "unclassified_count": sum(1 for d in classified if not d.detected_doc_type),
            "tech_commercialization": tech_comm,
        },
    )
    case.audit_trail.append(audit)
    return case


def _is_tech_commercialization(case: Case, scenario_folder: str) -> bool:
    """Read application_form.json to determine technology_commercialization flag."""
    app_form = Path(scenario_folder) / "application_form.json"
    if app_form.exists():
        try:
            with open(app_form, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            project = data.get("project", {})
            return bool(project.get("technology_commercialization", False))
        except Exception:
            pass
    return False
