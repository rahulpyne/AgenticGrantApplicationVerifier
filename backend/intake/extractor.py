"""
Field extractor — extracts the 7 key data fields (DF-01 through DF-07)
from classified submission documents.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from models.schemas import AuditEvent, Case, EventType, ExtractedField


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_doc_path(case: Case, doc_type: str, scenario_folder: str) -> Optional[str]:
    """Return filesystem path to first file matching doc_type (with >= 0.70 confidence)."""
    folder = Path(scenario_folder)
    best = None
    best_conf = -1.0
    for doc in case.documents:
        if doc.detected_doc_type == doc_type and doc.confidence >= best_conf:
            path = folder / doc.name
            if path.exists():
                best = str(path)
                best_conf = doc.confidence
    return best


def _read_pdf_text(filepath: str) -> str:
    """Extract all text from a PDF using pypdf."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(filepath)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def _unwrap(val: Any, default_confidence: float = 0.97) -> Tuple[Any, float, Optional[str]]:
    """
    Handle TC-11 special case: if the raw value is a dict with a 'confidence' sub-key,
    unpack it. Otherwise return the value as-is with default_confidence.
    Returns (value, confidence, note).
    """
    if isinstance(val, dict) and "confidence" in val:
        value = val.get("value")
        conf = float(val.get("confidence", default_confidence))
        note = val.get("note")
        return value, conf, note
    return val, default_confidence, None


# ---------------------------------------------------------------------------
# DOC-01: application_form.json
# ---------------------------------------------------------------------------

def _extract_from_app_form(
    filepath: str,
    case: Case,
    scenario_folder: str,
) -> Dict[str, ExtractedField]:
    """Parse application_form.json and return dict of field_id → ExtractedField."""
    fields: Dict[str, ExtractedField] = {}

    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return fields

    org = data.get("organization", {})
    project = data.get("project", {})
    funding = data.get("funding", {})

    # DF-01: Legal name
    raw = org.get("legal_name")
    if raw is not None:
        val, conf, note = _unwrap(raw, 0.97)
        excerpt = f"organization.legal_name = {val!r}"
        if note:
            excerpt += f" [{note}]"
        fields["DF-01"] = ExtractedField(
            field_id="DF-01",
            name="Applicant Legal Name",
            value=val,
            source_doc_id="DOC-01",
            confidence=conf,
            raw_excerpt=excerpt,
        )

    # DF-02: CRA business number
    raw = org.get("cra_business_number")
    if raw is not None:
        val, conf, note = _unwrap(raw, 0.97)
        bn_str = str(val).strip() if val is not None else ""
        valid = bool(re.match(r"^\d{9}$", bn_str))
        if not valid and val is not None:
            conf = min(conf, 0.55)
            note = (note or "") + f" [Warning: '{bn_str}' is not a valid 9-digit CRA BN]"
        fields["DF-02"] = ExtractedField(
            field_id="DF-02",
            name="CRA Business Number",
            value=val,
            source_doc_id="DOC-01",
            confidence=conf,
            raw_excerpt=f"organization.cra_business_number = {val!r}" + (f" [{note}]" if note else ""),
        )

    # DF-03: Incorporation / establishment date
    raw = (
        org.get("incorporation_date")
        or org.get("date_established_in_canada")
        or org.get("date_established")
    )
    if raw is not None:
        val, conf, note = _unwrap(raw, 0.97)
        fields["DF-03"] = ExtractedField(
            field_id="DF-03",
            name="Incorporation Date",
            value=val,
            source_doc_id="DOC-01",
            confidence=conf,
            raw_excerpt=f"organization.incorporation_date = {val!r}",
        )

    # DF-04: Location (province + BC facility)
    address = project.get("address")
    province = None
    if isinstance(address, dict):
        province, _, _ = _unwrap(address.get("province"), 0.95)
    elif isinstance(address, str):
        province = address

    raw_bc = org.get("bc_operating_facilities")
    bc_val, bc_conf, _ = _unwrap(raw_bc, 0.95) if raw_bc is not None else (None, 0.95, None)

    loc_val = {}
    if province is not None:
        loc_val["province"] = province
    if bc_val is not None:
        loc_val["bc_operating_facilities"] = bc_val

    if loc_val:
        fields["DF-04"] = ExtractedField(
            field_id="DF-04",
            name="Location (Province + BC Facility)",
            value=loc_val,
            source_doc_id="DOC-01",
            confidence=0.95,
            raw_excerpt=(
                f"project.address.province={province!r}, "
                f"organization.bc_operating_facilities={bc_val!r}"
            ),
        )

    # DF-05: Requested PacifiCan amount
    raw = funding.get("total_rda_funding_requested")
    if raw is not None:
        val, conf, note = _unwrap(raw, 0.97)
        fields["DF-05"] = ExtractedField(
            field_id="DF-05",
            name="Requested PacifiCan Amount",
            value=val,
            source_doc_id="DOC-01",
            confidence=conf,
            raw_excerpt=f"funding.total_rda_funding_requested = {val!r}",
        )

    # DF-06: Matching (non-PacifiCan) funding + confirmation presence
    raw = funding.get("total_non_rda_funding")
    if raw is not None:
        val, conf, note = _unwrap(raw, 0.90)
        doc06_present = any(d.detected_doc_type == "DOC-06" for d in case.documents)
        fields["DF-06"] = ExtractedField(
            field_id="DF-06",
            name="Matching (Non-PacifiCan) Funding",
            value={"amount": val, "confirmation_present": doc06_present},
            source_doc_id="DOC-01",
            confidence=conf,
            raw_excerpt=(
                f"funding.total_non_rda_funding = {val!r}, "
                f"DOC-06 present = {doc06_present}"
            ),
        )

    # DF-07: Project period
    raw_start = project.get("start_date")
    raw_end = project.get("end_date")
    if raw_start is not None or raw_end is not None:
        sv, sc, _ = _unwrap(raw_start, 0.97) if raw_start is not None else (None, 0.0, None)
        ev, ec, _ = _unwrap(raw_end, 0.97) if raw_end is not None else (None, 0.0, None)
        confs = [c for c in [sc, ec] if c > 0]
        period_conf = min(confs) if confs else 0.0
        fields["DF-07"] = ExtractedField(
            field_id="DF-07",
            name="Project Period",
            value={"start_date": sv, "end_date": ev},
            source_doc_id="DOC-01",
            confidence=period_conf,
            raw_excerpt=f"project.start_date = {sv!r}, project.end_date = {ev!r}",
        )

    # TC-11: apply _extraction_overrides if present in the JSON
    overrides = data.get("_extraction_overrides", {})
    FIELD_MAP = {
        "cra_business_number": "DF-02",
        "incorporation_date": "DF-03",
        "legal_name": "DF-01",
        "rda_funding_requested": "DF-05",
        "non_rda_funding": "DF-06",
        "project_period": "DF-07",
    }
    for key, override in overrides.items():
        fid = FIELD_MAP.get(key)
        if fid and fid in fields and isinstance(override, dict) and "confidence" in override:
            f = fields[fid]
            note = override.get("note", "")
            fields[fid] = ExtractedField(
                field_id=f.field_id,
                name=f.name,
                value=override.get("value"),
                source_doc_id=f.source_doc_id,
                confidence=float(override["confidence"]),
                raw_excerpt=(f.raw_excerpt or "") + (f" [OVERRIDE: {note}]" if note else ""),
                manually_corrected=f.manually_corrected,
                correction_history=f.correction_history,
            )

    return fields


# ---------------------------------------------------------------------------
# DOC-07: Supplemental PDF — cross-check legal name
# ---------------------------------------------------------------------------

def _extract_legal_name_from_supplemental(filepath: str) -> Optional[str]:
    text = _read_pdf_text(filepath)
    if not text:
        return None
    patterns = [
        r"(?:LEGAL NAME|Legal Name of Business|Legal Name)[:\s]+([^\n]+)",
        r"(?:Organization Name|Applicant Name)[:\s]+([^\n]+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            if name:
                return name
    return None


# ---------------------------------------------------------------------------
# DOC-04: Budget worksheet — cross-check legal name
# ---------------------------------------------------------------------------

def _extract_legal_name_from_budget(filepath: str) -> Optional[str]:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(filepath, data_only=True)
        sheet = None
        for sname in wb.sheetnames:
            if "cost detail" in sname.lower():
                sheet = wb[sname]
                break
        if sheet is None and wb.sheetnames:
            sheet = wb.active
        if sheet is None:
            return None
        for row in sheet.iter_rows():
            for cell in row:
                if cell.value and isinstance(cell.value, str) and "applicant" in cell.value.lower():
                    # Try adjacent cells to the right
                    for offset in range(1, 5):
                        adj = sheet.cell(row=cell.row, column=cell.column + offset)
                        if adj.value and isinstance(adj.value, str):
                            name = adj.value.strip()
                            if name and name.lower() not in ("applicant", "name", "organization"):
                                return name
                    break
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# PDF header name extraction (DOC-02, DOC-03, DOC-05, DOC-06)
# ---------------------------------------------------------------------------

def _extract_org_name_from_pdf_header(filepath: str) -> Optional[str]:
    """
    Extract the organisation name from a financial statement, business plan,
    or funding confirmation letter.  In these document types the legal name
    is typically the very first non-trivial line of text (e.g. the heading
    "CASCADIA DEFENCE SYSTEMS INC." that appears before the document title).
    Falls back to searching the full text for an ALL-CAPS or Title-Case
    line that looks like a company name.
    """
    text = _read_pdf_text(filepath)
    if not text:
        return None

    skip_patterns = re.compile(
        r"^(for\b|page\b|date\b|prepared|the period|letter|financial|statement|"
        r"interim|annual|business plan|bc tech|award|inc\.|ltd\.|\d)",
        re.IGNORECASE,
    )
    for line in text.splitlines():
        line = line.strip()
        if not line or len(line) < 5 or len(line) > 120:
            continue
        if skip_patterns.match(line):
            continue
        # Prefer lines that look like company names (contain "Inc.", "Ltd.", "Corp.",
        # "Systems", "Defence", etc. OR are written in ALL CAPS).
        looks_like_name = (
            re.search(r"\b(inc|ltd|corp|limited|systems|defence|defense|technologies|solutions)\b",
                      line, re.IGNORECASE)
            or line == line.upper()
        )
        if looks_like_name:
            return line
    return None


# ---------------------------------------------------------------------------
# Budget worksheet total reader (shared between extractor and rules engine)
# ---------------------------------------------------------------------------

def _read_budget_total(filepath: str) -> Optional[float]:
    """
    Return the Total Project Costs from the Cost Detail sheet.
    Tries 'Total Project Costs (Current)' first, then '(Application)'.
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(filepath, data_only=True)
        sheet = None
        for sname in wb.sheetnames:
            if "cost detail" in sname.lower():
                sheet = wb[sname]
                break
        if sheet is None and wb.sheetnames:
            sheet = wb.active
        if sheet is None:
            return None
        current: Optional[float] = None
        application: Optional[float] = None
        for row in sheet.iter_rows():
            label = ""
            for cell in row:
                if cell.value and isinstance(cell.value, str):
                    label = cell.value.strip().lower()
                    break
            if "total project costs (current)" in label:
                for cell in reversed(row):
                    if isinstance(cell.value, (int, float)):
                        current = float(cell.value)
                        break
            elif "total project costs (application)" in label:
                for cell in reversed(row):
                    if isinstance(cell.value, (int, float)):
                        application = float(cell.value)
                        break
        return current or application
    except Exception:
        return None


# ---------------------------------------------------------------------------
# DF-05 cross-check: requested amount vs budget worksheet total
# ---------------------------------------------------------------------------

def _cross_check_df05(
    extracted: Dict[str, ExtractedField],
    case: Case,
    scenario_folder: str,
) -> Dict[str, ExtractedField]:
    """
    Compare the declared PacifiCan requested amount (DF-05) against the
    Total Project Costs in the budget worksheet (DOC-04).

    The requested PacifiCan contribution must be ≤ total project costs.
    If the declared amount exceeds the budget total the confidence drops
    and a BUDGET MISMATCH note is added to raw_excerpt.
    """
    df05 = extracted.get("DF-05")
    if not (df05 and df05.value is not None and df05.source_doc_id == "DOC-01"):
        return extracted

    requested = None
    raw_val = df05.value
    if isinstance(raw_val, (int, float)):
        requested = float(raw_val)
    elif isinstance(raw_val, dict):
        amt = raw_val.get("amount") or raw_val.get("value")
        if isinstance(amt, (int, float)):
            requested = float(amt)

    if requested is None:
        return extracted

    budget_path = _get_doc_path(case, "DOC-04", scenario_folder)
    if not budget_path:
        base = df05.raw_excerpt or f"funding.total_rda_funding_requested = {requested!r}"
        extracted["DF-05"] = df05.model_copy(update={
            "raw_excerpt": base + " | ℹ form declaration only — DOC-04 not submitted; budget cross-check not possible",
        })
        return extracted

    budget_total = _read_budget_total(budget_path)
    base = df05.raw_excerpt or f"funding.total_rda_funding_requested = {requested!r}"

    if budget_total is None:
        extracted["DF-05"] = df05.model_copy(update={
            "raw_excerpt": base + " | ℹ DOC-04 present but total project costs row could not be read",
        })
        return extracted

    if requested > budget_total:
        new_conf = round(df05.confidence * 0.45, 2)
        note = (
            f"⚠ BUDGET MISMATCH — declared request ${requested:,.0f} exceeds "
            f"budget worksheet total ${budget_total:,.0f}"
        )
    else:
        new_conf = df05.confidence
        pct = requested / budget_total * 100 if budget_total > 0 else 0.0
        note = (
            f"✓ budget cross-check: ${requested:,.0f} = {pct:.1f}% of "
            f"worksheet total ${budget_total:,.0f}"
        )

    extracted["DF-05"] = df05.model_copy(update={
        "confidence": new_conf,
        "raw_excerpt": base + " | " + note,
    })
    return extracted


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _normalise_name(name: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace for name comparison."""
    name = name.lower()
    name = re.sub(r"[^\w\s]", "", name)
    return re.sub(r"\s+", " ", name).strip()


def _names_match(a: str, b: str) -> bool:
    return bool(a) and bool(b) and _normalise_name(a) == _normalise_name(b)


def _cross_check_df01(
    extracted: Dict[str, ExtractedField],
    case: Case,
    scenario_folder: str,
) -> Dict[str, ExtractedField]:
    """
    Cross-validate DF-01 (Legal Name) against uploaded documents.

    When the value was declared in the application form (DOC-01) we must
    verify it against DOC-07 (supplemental PDF) and DOC-04 (budget worksheet)
    if those documents were submitted.

    Outcomes:
    - Doc confirms name  → corroboration note added to raw_excerpt; confidence kept
    - Doc contradicts    → excerpt shows the mismatch; confidence drops to 0.40
                           (below R-009 threshold of 0.60 → triggers manual-review)
    - Doc present, name  → manual-review note; confidence unchanged
      could not be parsed
    - No cross-docs at   → "form declaration only" note; confidence unchanged
      all
    """
    df01 = extracted.get("DF-01")
    # Only cross-check when the primary source was the application form
    if not (df01 and df01.value is not None and df01.source_doc_id == "DOC-01"):
        return extracted

    app_name = str(df01.value)
    corroborations: List[str] = []
    contradictions: List[str] = []
    parse_failures: List[str] = []
    checked_docs: List[str] = []

    # ── DOC-07: supplemental form ──────────────────────────────────────────────
    supp_path = _get_doc_path(case, "DOC-07", scenario_folder)
    if supp_path:
        checked_docs.append("DOC-07")
        supp_name = _extract_legal_name_from_supplemental(supp_path)
        if supp_name:
            if _names_match(app_name, supp_name):
                corroborations.append(f"DOC-07 confirms '{supp_name}'")
            else:
                contradictions.append(f"DOC-07 says '{supp_name}'")
        else:
            parse_failures.append("DOC-07 (name line not found in supplemental PDF)")

    # ── DOC-04: budget worksheet ───────────────────────────────────────────────
    budget_path = _get_doc_path(case, "DOC-04", scenario_folder)
    if budget_path:
        checked_docs.append("DOC-04")
        budget_name = _extract_legal_name_from_budget(budget_path)
        if budget_name:
            if _names_match(app_name, budget_name):
                corroborations.append(f"DOC-04 confirms '{budget_name}'")
            else:
                contradictions.append(f"DOC-04 says '{budget_name}'")
        else:
            parse_failures.append("DOC-04 (applicant row not found in budget worksheet)")

    # ── Additional PDFs: financial statements, business plan, funding letter ──
    # These documents reliably carry the legal name in their header.
    # We extract the first organisation-name-looking line and compare.
    PDF_SOURCES: List[Tuple[str, str]] = [
        ("DOC-02", "annual financial statements"),
        ("DOC-03", "interim financial statements"),
        ("DOC-05", "business plan"),
        ("DOC-06", "funding confirmation letter"),
    ]
    for doc_type, doc_label in PDF_SOURCES:
        pdf_path = _get_doc_path(case, doc_type, scenario_folder)
        if not pdf_path:
            continue
        checked_docs.append(doc_type)
        detected = _extract_org_name_from_pdf_header(pdf_path)
        if detected:
            if _names_match(app_name, detected):
                corroborations.append(f"{doc_type} ({doc_label}) confirms '{detected}'")
            else:
                contradictions.append(f"{doc_type} ({doc_label}) says '{detected}'")
        else:
            # Could not parse a name from this PDF — note it but don't penalise
            parse_failures.append(f"{doc_type} ({doc_label}) — name not parseable from PDF")

    # ── Build updated excerpt and confidence ───────────────────────────────────
    base_excerpt = df01.raw_excerpt or f"organization.legal_name = {app_name!r}"
    new_conf = df01.confidence
    extra: List[str] = []

    if contradictions:
        # Drop well below the 0.60 R-009 threshold so manual-review fires
        new_conf = round(df01.confidence * 0.40, 2)
        extra.append("⚠ CROSS-CHECK MISMATCH — " + "; ".join(contradictions))
        if corroborations:
            extra.append("partial corroboration: " + "; ".join(corroborations))
    elif corroborations:
        extra.append("✓ cross-checked: " + "; ".join(corroborations))
        if parse_failures:
            extra.append("could not parse: " + "; ".join(parse_failures))
    elif parse_failures:
        extra.append("ℹ submitted docs could not be parsed for name: " + "; ".join(parse_failures))
    elif not checked_docs:
        extra.append(
            "ℹ form declaration only — DOC-07 and DOC-04 not submitted; "
            "cross-document name verification not possible"
        )

    new_excerpt = base_excerpt + (" | " + " | ".join(extra) if extra else "")

    extracted["DF-01"] = df01.model_copy(update={
        "confidence": new_conf,
        "raw_excerpt": new_excerpt,
    })
    return extracted


def extract_fields(case: Case, scenario_folder: str) -> Case:
    """
    Extract 7 key fields (DF-01 to DF-07) from documents.
    Updates case.extracted_fields (dict) and adds an audit event.

    Returns updated Case.
    """
    extracted: Dict[str, ExtractedField] = {}

    # ---- DOC-01: application form JSON (primary source) -----------------------
    app_path = _get_doc_path(case, "DOC-01", scenario_folder)
    if app_path:
        form_fields = _extract_from_app_form(app_path, case, scenario_folder)
        extracted.update(form_fields)

    # ---- DOC-07 / DOC-04: fallback extraction when no form is present ---------
    # These paths only run when application_form.json was NOT submitted.
    supp_path = _get_doc_path(case, "DOC-07", scenario_folder)
    if supp_path and "DF-01" not in extracted:
        name = _extract_legal_name_from_supplemental(supp_path)
        if name:
            extracted["DF-01"] = ExtractedField(
                field_id="DF-01",
                name="Applicant Legal Name",
                value=name,
                source_doc_id="DOC-07",
                confidence=0.85,
                raw_excerpt=f"Extracted from supplemental form: {name!r}",
            )

    budget_path = _get_doc_path(case, "DOC-04", scenario_folder)
    if budget_path and "DF-01" not in extracted:
        name = _extract_legal_name_from_budget(budget_path)
        if name:
            extracted["DF-01"] = ExtractedField(
                field_id="DF-01",
                name="Applicant Legal Name",
                value=name,
                source_doc_id="DOC-04",
                confidence=0.85,
                raw_excerpt=f"Extracted from budget worksheet: {name!r}",
            )

    # ---- Cross-check form-declared values against uploaded documents ----------
    # Always runs when a form is present; updates confidence + raw_excerpt.
    extracted = _cross_check_df01(extracted, case, scenario_folder)
    extracted = _cross_check_df05(extracted, case, scenario_folder)

    # ---- Fill missing fields with empty placeholders --------------------------
    ALL_FIELDS = {
        "DF-01": "Applicant Legal Name",
        "DF-02": "CRA Business Number",
        "DF-03": "Incorporation Date",
        "DF-04": "Location (Province + BC Facility)",
        "DF-05": "Requested PacifiCan Amount",
        "DF-06": "Matching (Non-PacifiCan) Funding",
        "DF-07": "Project Period",
    }
    for fid, fname in ALL_FIELDS.items():
        if fid not in extracted:
            extracted[fid] = ExtractedField(
                field_id=fid,
                name=fname,
                value=None,
                source_doc_id=None,
                confidence=0.0,
                raw_excerpt=None,
            )

    case.extracted_fields = extracted

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.extraction_completed,
        actor="system",
        details={
            "fields_extracted": [fid for fid, f in extracted.items() if f.value is not None],
            "fields_missing":   [fid for fid, f in extracted.items() if f.value is None],
            "cross_check_mismatches": [
                fid for fid, f in extracted.items()
                if f.raw_excerpt and ("CROSS-CHECK MISMATCH" in f.raw_excerpt or "BUDGET MISMATCH" in f.raw_excerpt)
            ],
        },
    )
    case.audit_trail.append(audit)
    return case
