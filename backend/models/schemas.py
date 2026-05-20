"""
Pydantic models for the RDII Intake Triage System.
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DocumentStatus(str, Enum):
    present = "present"
    missing = "missing"
    uncertain = "uncertain"
    not_applicable = "not_applicable"


class Basket(str, Enum):
    complete = "complete"
    incomplete = "incomplete"
    decline_basket = "decline_basket"


class Severity(str, Enum):
    error = "error"
    warning = "warning"
    info = "info"
    manual_review = "manual_review"


class EventType(str, Enum):
    case_created = "case_created"
    documents_ingested = "documents_ingested"
    classification_completed = "classification_completed"
    extraction_completed = "extraction_completed"
    rules_evaluated = "rules_evaluated"
    basket_assigned = "basket_assigned"
    draft_email_generated = "draft_email_generated"
    email_reviewed = "email_reviewed"
    email_sent = "email_sent"
    manager_decision_recorded = "manager_decision_recorded"
    field_corrected = "field_corrected"
    doc_type_overridden = "doc_type_overridden"
    manager_queue_added = "manager_queue_added"


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class ExtractedField(BaseModel):
    field_id: str                                # "DF-01" … "DF-07"
    name: str
    value: Optional[Any] = None
    source_doc_id: Optional[str] = None         # "DOC-01" etc.
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    raw_excerpt: Optional[str] = None
    manually_corrected: bool = False
    correction_history: List[Dict[str, Any]] = Field(default_factory=list)


class DocumentRecord(BaseModel):
    file_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    extension: str
    size_bytes: int
    parse_status: str = "pending"                # pending | parsed | error | unclassified
    detected_doc_type: Optional[str] = None     # "DOC-01" … "DOC-08" | None
    confidence: float = 0.0
    matched_on: str = "filename"                # "filename" | "content" | "canonical"
    notes: Optional[str] = None


class ChecklistItem(BaseModel):
    doc_id: str                                  # "DOC-01" … "DOC-08"
    category: str                                # human-readable label
    status: DocumentStatus = DocumentStatus.missing
    matched_files: List[str] = Field(default_factory=list)   # file names
    confidence: float = 0.0
    notes: Optional[str] = None


class Finding(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    severity: Severity
    message: str
    rule_id: str                                # "R-001" … "R-012"


class EligibilityFlag(BaseModel):
    flag_id: str                                # "ER-01" … "ER-09"
    label: str
    status: str                                 # "flagged" | "ok" | "needs_review"
    detail: Optional[str] = None


class AuditEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    case_id: str
    timestamp: str                              # ISO-8601 string
    event_type: EventType
    actor: str = "system"
    details: Dict[str, Any] = Field(default_factory=dict)


class EmailDraft(BaseModel):
    subject: str = ""
    body: str = ""
    reviewed: bool = False
    sent: bool = False
    sent_at: Optional[str] = None
    sent_by: Optional[str] = None


class Case(BaseModel):
    case_id: str
    submission_timestamp: str                   # ISO-8601 string
    status: str = "intake_pending"
    basket: Optional[Basket] = None
    missing_count: int = 0
    missing_categories: List[str] = Field(default_factory=list)
    documents: List[DocumentRecord] = Field(default_factory=list)
    checklist: List[ChecklistItem] = Field(default_factory=list)
    extracted_fields: Dict[str, ExtractedField] = Field(default_factory=dict)
    eligibility_flags: List[EligibilityFlag] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    email_draft: Optional[EmailDraft] = None
    manager_confirmed: bool = False
    manager_decision: Optional[str] = None
    audit_trail: List[AuditEvent] = Field(default_factory=list)
    scenario_folder: Optional[str] = None
