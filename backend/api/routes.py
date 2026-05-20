"""
FastAPI routes for the RDII Intake Triage System.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.schemas import (
    AuditEvent,
    Basket,
    Case,
    EmailDraft,
    EventType,
    ExtractedField,
    Severity,
    Finding,
)
from store import case_store
from comms import email_draft as email_draft_module
from comms import manager_queue as mq_module
from intake import trigger, ingestion, classifier, extractor, rules_engine, router as case_router

TEST_DATA_DIR = Path("/Users/rahulpyne/pacifican/rdii-prototype/test_data")
UPLOAD_DIR = Path("/Users/rahulpyne/pacifican/rdii-prototype/store/uploads")

_TEST_SCENARIOS: Dict[str, str] = {
    "TC-01-complete-tech": "Complete technology commercialization application — all 8 required documents",
    "TC-02-complete-nontech": "Complete non-tech application — 7 documents (no tech questionnaire required)",
    "TC-03-incomplete-one-missing": "1 missing document (funding confirmation letter)",
    "TC-04-incomplete-two-missing": "2 missing documents (interim financials + supplemental form)",
    "TC-05-incomplete-missing-techq": "Tech project missing its technology questionnaire",
    "TC-06-decline-basket": "5+ missing documents — triggers decline basket routing",
    "TC-07-name-mismatch": "Legal name mismatch across application form, supplemental form, and budget",
    "TC-08-budget-mismatch": "Budget total in application form differs from worksheet total",
    "TC-09-date-out-of-window": "Project period falls outside the Apr 2026 – Mar 2028 eligible window",
    "TC-10-weak-funding-proof": "Funding confirmation letter is missing a forecast year",
    "TC-11-low-confidence": "Key fields extracted with low confidence — manual review required",
    "TC-12-duplicate-uploads": "Duplicate files uploaded, causing a document category to remain unmatched",
}

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_scenario_folder(scenario_folder: str) -> str:
    """
    Resolve scenario folder to an absolute path.
    If it looks like a name (no path separators), look in test_data/.
    """
    p = Path(scenario_folder)
    if p.is_absolute() and p.exists():
        return str(p)
    # Try as a name relative to test_data
    candidate = TEST_DATA_DIR / scenario_folder
    if candidate.exists():
        return str(candidate)
    # Try matching by prefix (e.g., "TC-01")
    if TEST_DATA_DIR.exists():
        for child in sorted(TEST_DATA_DIR.iterdir()):
            if child.is_dir() and child.name.startswith(scenario_folder):
                return str(child)
    return str(p)


def _run_full_pipeline(scenario_folder: str, case_id: Optional[str] = None) -> Case:
    """Run the complete intake pipeline and return the final case."""
    resolved = _resolve_scenario_folder(scenario_folder)

    # 1. Create case
    case = trigger.create_case(resolved, case_id=case_id)

    # 2. Ingest documents
    case = ingestion.ingest_documents(case, resolved)

    # 3. Classify documents
    case = classifier.classify_documents(case, resolved)

    # 4. Extract fields
    case = extractor.extract_fields(case, resolved)

    # 5. Run rules engine
    case = rules_engine.run_rules(case, resolved)

    # 6. Route
    case = case_router.route_case(case, resolved)

    # 7. Post-routing actions
    if case.basket == Basket.incomplete:
        case = email_draft_module.generate_email_draft(case)

    if case.basket == Basket.decline_basket:
        case = mq_module.add_to_manager_queue(case)

    case_store.save_case(case)
    return case


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------

class SubmitRequest(BaseModel):
    scenario_folder: str
    case_id: Optional[str] = None


@router.post("/cases/submit")
def submit_case(body: SubmitRequest) -> Case:
    """Trigger full intake pipeline for a scenario folder."""
    try:
        case = _run_full_pipeline(body.scenario_folder, case_id=body.case_id)
        return case
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Case listing and detail
# ---------------------------------------------------------------------------

@router.get("/cases")
def list_cases() -> List[Dict[str, Any]]:
    """List all cases with summary information."""
    cases = case_store.list_cases()
    summaries = []
    for c in cases:
        df01 = c.extracted_fields.get("DF-01")
        warn_sevs = {"warning", "error", "manual_review"}
        findings_count = sum(1 for f in c.findings if f.severity.value in warn_sevs)
        summaries.append({
            "case_id": c.case_id,
            "submission_timestamp": c.submission_timestamp,
            "status": c.status,
            "basket": c.basket.value if c.basket else None,
            "missing_count": c.missing_count,
            "applicant_name": str(df01.value) if df01 and df01.value else None,
            "findings_count": findings_count,
            "scenario_folder": c.scenario_folder,
        })
    return summaries


@router.get("/cases/{case_id}")
def get_case(case_id: str) -> Case:
    """Get full case detail."""
    try:
        return case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")


# ---------------------------------------------------------------------------
# Field corrections
# ---------------------------------------------------------------------------

class FieldCorrectionRequest(BaseModel):
    value: Any
    reason_note: str
    officer_id: Optional[str] = "officer"


@router.patch("/cases/{case_id}/fields/{field_id}")
def correct_field(case_id: str, field_id: str, body: FieldCorrectionRequest) -> Case:
    """Officer field correction. Requires a non-empty reason_note."""
    if not body.reason_note or not body.reason_note.strip():
        raise HTTPException(status_code=400, detail="reason_note is required and must not be empty")

    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")

    if field_id not in case.extracted_fields:
        raise HTTPException(status_code=404, detail=f"Field {field_id!r} not found in case")

    field = case.extracted_fields[field_id]
    old_value = field.value

    # Record correction history
    history_entry = {
        "timestamp": _now_iso(),
        "officer_id": body.officer_id,
        "old_value": old_value,
        "new_value": body.value,
        "reason_note": body.reason_note,
    }

    updated_field = field.model_copy(update={
        "value": body.value,
        "manually_corrected": True,
        "correction_history": field.correction_history + [history_entry],
    })
    case.extracted_fields[field_id] = updated_field

    audit = AuditEvent(
        case_id=case_id,
        timestamp=_now_iso(),
        event_type=EventType.field_corrected,
        actor=body.officer_id or "officer",
        details={
            "field_id": field_id,
            "old_value": str(old_value),
            "new_value": str(body.value),
            "reason_note": body.reason_note,
        },
    )
    case.audit_trail.append(audit)
    case_store.save_case(case)
    return case


# ---------------------------------------------------------------------------
# Document type override
# ---------------------------------------------------------------------------

class DocTypeOverrideRequest(BaseModel):
    doc_type: str
    reason_note: str
    officer_id: Optional[str] = "officer"


@router.patch("/cases/{case_id}/documents/{doc_id}/type")
def override_doc_type(case_id: str, doc_id: str, body: DocTypeOverrideRequest) -> Case:
    """Officer document type override. Requires a non-empty reason_note."""
    if not body.reason_note or not body.reason_note.strip():
        raise HTTPException(status_code=400, detail="reason_note is required and must not be empty")

    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")

    target = next((d for d in case.documents if d.file_id == doc_id or d.name == doc_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Document {doc_id!r} not found in case")

    old_type = target.detected_doc_type
    updated = target.model_copy(update={
        "detected_doc_type": body.doc_type,
        "matched_on": "officer_override",
    })
    case.documents = [updated if d.file_id == target.file_id else d for d in case.documents]

    audit = AuditEvent(
        case_id=case_id,
        timestamp=_now_iso(),
        event_type=EventType.doc_type_overridden,
        actor=body.officer_id or "officer",
        details={
            "document": target.name,
            "old_type": old_type,
            "new_type": body.doc_type,
            "reason_note": body.reason_note,
        },
    )
    case.audit_trail.append(audit)
    case_store.save_case(case)
    return case


# ---------------------------------------------------------------------------
# Email draft
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/email-draft")
def get_email_draft(case_id: str) -> EmailDraft:
    """Get the draft email. 404 if not incomplete basket."""
    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    if case.email_draft is None:
        raise HTTPException(status_code=404, detail="No email draft exists for this case")
    return case.email_draft


class EmailDraftUpdateRequest(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    officer_id: Optional[str] = "officer"


@router.patch("/cases/{case_id}/email-draft")
def update_email_draft(case_id: str, body: EmailDraftUpdateRequest) -> Case:
    """Officer edits to email body/subject."""
    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    if case.email_draft is None:
        raise HTTPException(status_code=404, detail="No email draft exists for this case")

    updates: Dict[str, Any] = {}
    if body.subject is not None:
        updates["subject"] = body.subject
    if body.body is not None:
        updates["body"] = body.body
    case.email_draft = case.email_draft.model_copy(update=updates)

    case_store.save_case(case)
    return case


@router.post("/cases/{case_id}/email-draft/mark-reviewed")
def mark_email_reviewed(
    case_id: str,
    officer_id: str = Body(default="officer", embed=True),
) -> Case:
    """Officer marks email as reviewed."""
    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    if case.email_draft is None:
        raise HTTPException(status_code=404, detail="No email draft exists for this case")

    case.email_draft = case.email_draft.model_copy(update={"reviewed": True})

    audit = AuditEvent(
        case_id=case_id,
        timestamp=_now_iso(),
        event_type=EventType.email_reviewed,
        actor=officer_id,
        details={"officer_id": officer_id},
    )
    case.audit_trail.append(audit)
    case_store.save_case(case)
    return case


class SendEmailRequest(BaseModel):
    officer_id: Optional[str] = "officer"


@router.post("/cases/{case_id}/email-draft/send")
def send_email(case_id: str, body: SendEmailRequest) -> Case:
    """
    Officer sends the email.
    GUARDRAIL: 403 if not reviewed (no email_reviewed audit event found).
    """
    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    if case.email_draft is None:
        raise HTTPException(status_code=404, detail="No email draft exists for this case")

    # GUARDRAIL: check audit trail for email_reviewed event
    reviewed_events = [
        e for e in case.audit_trail if e.event_type == EventType.email_reviewed
    ]
    if not reviewed_events:
        raise HTTPException(
            status_code=403,
            detail="Email must be marked as reviewed before it can be sent.",
        )

    now = _now_iso()
    case.email_draft = case.email_draft.model_copy(update={
        "sent": True,
        "sent_at": now,
        "sent_by": body.officer_id,
    })
    case.status = "document_request_sent"

    audit = AuditEvent(
        case_id=case_id,
        timestamp=now,
        event_type=EventType.email_sent,
        actor=body.officer_id or "officer",
        details={"sent_by": body.officer_id},
    )
    case.audit_trail.append(audit)
    case_store.save_case(case)
    return case


# ---------------------------------------------------------------------------
# Manager decision
# ---------------------------------------------------------------------------

class ManagerDecisionRequest(BaseModel):
    decision: str      # "confirm" | "return_to_incomplete" | "override_complete"
    comment: str
    manager_id: Optional[str] = "manager"


@router.post("/cases/{case_id}/manager-decision")
def manager_decision(case_id: str, body: ManagerDecisionRequest) -> Case:
    """
    Manager confirms/rejects/overrides a decline_basket case.
    GUARDRAIL: Only callable for decline_basket cases.
    """
    if not body.comment or not body.comment.strip():
        raise HTTPException(status_code=400, detail="comment is required and must not be empty")

    valid_decisions = {"confirm", "return_to_incomplete", "override_complete"}
    if body.decision not in valid_decisions:
        raise HTTPException(status_code=400, detail=f"decision must be one of {sorted(valid_decisions)}")

    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")

    # Update basket if override
    if body.decision == "override_complete":
        case.basket = Basket.complete
        case.status = "routed"
    elif body.decision == "return_to_incomplete":
        case.basket = Basket.incomplete
        case.status = "routed"
        # Generate email draft if not present
        if case.email_draft is None:
            case = email_draft_module.generate_email_draft(case)
    elif body.decision == "confirm":
        case.status = "decline_confirmed"
        case.manager_confirmed = True

    case.manager_decision = body.decision

    audit = AuditEvent(
        case_id=case_id,
        timestamp=_now_iso(),
        event_type=EventType.manager_decision_recorded,
        actor=body.manager_id or "manager",
        details={
            "decision": body.decision,
            "comment": body.comment,
            "manager_id": body.manager_id,
        },
    )
    case.audit_trail.append(audit)

    # Remove from manager queue if confirmed or overridden
    if body.decision in {"confirm", "override_complete"}:
        mq_module.remove_from_manager_queue(case_id)

    case_store.save_case(case)
    return case


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/audit")
def get_audit_trail(case_id: str) -> List[AuditEvent]:
    """Get full audit trail for a case."""
    try:
        case = case_store.load_case(case_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    return case.audit_trail


# ---------------------------------------------------------------------------
# Manager queue
# ---------------------------------------------------------------------------

@router.get("/manager/queue")
def get_manager_queue() -> List[Dict[str, Any]]:
    """List of decline basket cases awaiting manager confirmation."""
    return mq_module.get_manager_queue()


# ---------------------------------------------------------------------------
# Applicant submission portal
# ---------------------------------------------------------------------------

def _basket_message(case: Case) -> str:
    if case.basket == Basket.complete:
        return "Your application package is complete. Our team will review it and be in touch."
    if case.basket == Basket.incomplete:
        return (
            f"Your application is missing {case.missing_count} required document(s). "
            "You will receive an email requesting the outstanding materials."
        )
    return "Your application has been received and is under review by our team."


@router.post("/apply")
async def submit_application(
    applicant_name: str = Form(...),
    cra_business_number: str = Form(default=""),
    incorporation_date: str = Form(default=""),
    province: str = Form(default="BC"),
    pacifican_facility: bool = Form(default=True),
    project_type: str = Form(default="non_tech"),
    requested_amount: float = Form(default=0.0),
    marketing_amount: float = Form(default=0.0),
    project_start: str = Form(default=""),
    project_end: str = Form(default=""),
    files: List[UploadFile] = File(default=[]),
) -> Dict[str, Any]:
    """
    Applicant file upload endpoint. Accepts multipart form data with
    documents + applicant info fields. Runs the full intake pipeline
    and returns a case ID.
    """
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    submission_dir = UPLOAD_DIR / uuid.uuid4().hex[:8].upper()
    submission_dir.mkdir(parents=True)

    has_app_form = False
    for uf in files:
        filename = Path(uf.filename).name if uf.filename else "unnamed"
        dest = submission_dir / filename
        with dest.open("wb") as fh:
            shutil.copyfileobj(uf.file, fh)
        if filename == "application_form.json":
            has_app_form = True

    if not has_app_form:
        app_form: Dict[str, Any] = {
            "legal_name": applicant_name,
            "cra_business_number": cra_business_number,
            "incorporation_date": incorporation_date,
            "province": province,
            "pacifican_facility": pacifican_facility,
            "project_type": project_type,
            "requested_pacifican_amount": requested_amount,
            "marketing_non_pacifican_funding": marketing_amount,
            "project_period_start": project_start,
            "project_period_end": project_end,
        }
        with (submission_dir / "application_form.json").open("w") as fh:
            json.dump(app_form, fh, indent=2)

    try:
        case = _run_full_pipeline(str(submission_dir))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "case_id": case.case_id,
        "basket": case.basket.value if case.basket else None,
        "status": case.status,
        "missing_count": case.missing_count,
        "message": _basket_message(case),
    }


# ---------------------------------------------------------------------------
# Test packages
# ---------------------------------------------------------------------------

@router.get("/test-packages")
def list_test_packages() -> List[Dict[str, str]]:
    """List available test scenario packages for download."""
    return [
        {"name": name, "description": desc}
        for name, desc in _TEST_SCENARIOS.items()
    ]


@router.get("/test-packages/{name}/download")
def download_test_package(name: str) -> StreamingResponse:
    """Download a test scenario as a ZIP archive."""
    if name not in _TEST_SCENARIOS:
        raise HTTPException(status_code=404, detail=f"Test package {name!r} not found")

    folder = TEST_DATA_DIR / name
    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"Test data not found for {name!r}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(folder.iterdir()):
            if f.is_file():
                zf.write(f, f.name)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
    )
