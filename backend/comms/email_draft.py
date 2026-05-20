"""
Email draft generator for Incomplete basket cases.

IMPORTANT: This module ONLY generates draft emails.
Emails are NEVER sent without explicit human action (officer review + send confirmation).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from models.schemas import AuditEvent, Basket, Case, EmailDraft, EventType

# ---------------------------------------------------------------------------
# Plain-language document names (for end-applicant emails)
# ---------------------------------------------------------------------------
DOC_PLAIN_NAMES: dict[str, str] = {
    "DOC-02": "Financial statements for the two most recent complete fiscal years",
    "DOC-03": "Interim financial statements (period since most recent annual statements)",
    "DOC-04": "Detailed Budget Worksheet (RDII official XLSX format)",
    "DOC-05": "Business plan or pitch deck",
    "DOC-06": "Written confirmation of funding from all non-PacifiCan sources",
    "DOC-07": "RDII Mandatory Supplemental Form (completed and signed)",
    "DOC-08": "RDII Technology Questionnaire (required for technology commercialization projects)",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_applicant_name(case: Case) -> str:
    """Extract applicant name from extracted fields, falling back to a placeholder."""
    df01 = case.extracted_fields.get("DF-01")
    if df01 and df01.value:
        return str(df01.value)
    return "[Applicant]"


def generate_email_draft(case: Case) -> Case:
    """
    Generate a draft document-request email for Incomplete basket cases.

    GUARDRAIL: This function only sets EmailDraft.reviewed = False and
    EmailDraft.sent = False. The email is NEVER sent automatically.

    Args:
        case: Case in the 'incomplete' basket.

    Returns:
        Updated case with email_draft populated and an audit event appended.
    """
    applicant_name = _get_applicant_name(case)

    # Build the list of missing documents
    missing_doc_lines: list[str] = []
    for doc_id in case.missing_categories:
        plain_name = DOC_PLAIN_NAMES.get(doc_id, f"Document {doc_id}")
        missing_doc_lines.append(f"    • {plain_name}")

    missing_list_str = "\n".join(missing_doc_lines) if missing_doc_lines else "    (No specific documents identified)"

    subject = "RDII Application — Additional Documents Required"

    body = f"""Dear {applicant_name},

Thank you for submitting your application to the Regional Defence Investment Initiative (RDII).

Following our initial review, we require the following additional document(s) to complete the assessment of your application:

{missing_list_str}

Please submit the outstanding documentation within one (1) week of the date of this email through the original submission portal.

If you have any questions, please contact your PacifiCan regional office.

[Officer Name]
[Officer Title]
Pacific Economic Development Canada / PacifiCan"""

    draft = EmailDraft(
        subject=subject,
        body=body,
        reviewed=False,
        sent=False,
    )

    case.email_draft = draft

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.draft_email_generated,
        actor="system",
        details={
            "missing_doc_count": len(case.missing_categories),
            "missing_categories": case.missing_categories,
            "applicant_name": applicant_name,
        },
    )
    case.audit_trail.append(audit)
    return case
