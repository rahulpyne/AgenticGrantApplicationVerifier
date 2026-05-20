"""
File ingestion — scans a submission folder and records every file as a DocumentRecord.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from models.schemas import AuditEvent, Case, DocumentRecord, EventType


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ingest_documents(case: Case, scenario_folder: str) -> Case:
    """
    Scan scenario_folder for all files, create DocumentRecord for each,
    append to case.documents, record audit event.

    Args:
        case:            Current Case object.
        scenario_folder: Absolute path to the submission folder.

    Returns:
        Updated Case.
    """
    folder = Path(scenario_folder)
    records: list[DocumentRecord] = []

    if folder.exists() and folder.is_dir():
        for entry in sorted(folder.iterdir()):
            if not entry.is_file():
                continue

            extension = entry.suffix.lower()
            try:
                size_bytes = entry.stat().st_size
            except OSError:
                size_bytes = 0

            # Determine parse_status based on extension
            if extension in {".json", ".xlsx", ".xls", ".pdf", ".docx", ".doc"}:
                parse_status = "parsed"
            else:
                parse_status = "pending"

            record = DocumentRecord(
                file_id=str(uuid.uuid4()),
                name=entry.name,
                extension=extension,
                size_bytes=size_bytes,
                parse_status=parse_status,
            )
            records.append(record)

    case.documents = records

    audit = AuditEvent(
        case_id=case.case_id,
        timestamp=_now_iso(),
        event_type=EventType.documents_ingested,
        actor="system",
        details={
            "file_count": len(records),
            "files": [r.name for r in records],
        },
    )
    case.audit_trail.append(audit)

    return case
