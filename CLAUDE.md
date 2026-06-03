# RDII Prototype — Full Project Context for Claude Code

> **Purpose of this file**: This file was generated to preserve the full context of the development
> session so it can be loaded in any Claude Code terminal (cloud or local) with complete history.
> Drop this file in the project root and open the folder in Claude Code — it will be read automatically.

---

## 1. What This Project Is

**RDII** = Regional Development Investment Initiative — a **PacifiCan** (Pacific Economic Development Canada) grant application intake system.

The prototype automates the triage of incoming funding applications:
1. Applicant submits a form + document package (PDFs)
2. A 6-step pipeline classifies documents, extracts key fields, runs 9 eligibility rules, and routes the case
3. Caseworkers see a full Chain-of-Thought AI decision trace explaining every decision
4. Incomplete cases auto-generate a document-request email draft; decline cases go to a manager queue

**Live deployment**: Vercel (frontend + backend as serverless functions)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2 |
| Frontend | React 18, TypeScript, Vite |
| Deployment | Vercel (serverless) |
| Storage (current) | `/tmp` flat JSON files on Vercel Lambda (ephemeral) |
| PDF parsing | `pypdf` / `pdfplumber` |
| Future target | Azure AI Foundry + Azure Container Apps + OpenWebUI (see Section 9) |

---

## 3. Repository Structure

```
rdii-prototype/
├── backend/
│   ├── api/
│   │   └── routes.py          ← All FastAPI endpoints including /apply (applicant portal)
│   ├── intake/
│   │   ├── trigger.py         ← Step 1: create Case object
│   │   ├── ingestion.py       ← Step 2: scan uploaded files into DocumentRecord list
│   │   ├── classifier.py      ← Step 3: map files to DOC-01…DOC-08 types
│   │   ├── extractor.py       ← Step 4: extract DF-01…DF-07 + cross-checks  ★ heavily modified
│   │   ├── rules_engine.py    ← Step 5: run R-001…R-009 eligibility rules    ★ heavily modified
│   │   └── router.py          ← Step 6: assign basket (complete/incomplete/decline)
│   ├── comms/
│   │   ├── email_draft.py     ← Draft document-request emails for incomplete cases
│   │   └── manager_queue.py   ← Queue cases for manager confirmation before decline
│   ├── models/
│   │   └── schemas.py         ← All Pydantic models (Case, ExtractedField, Finding, etc.)
│   ├── store/
│   │   └── case_store.py      ← Save/load Case objects as JSON files
│   └── main.py
├── frontend/
│   └── src/
│       ├── api.ts             ← Axios client — submitApplication returns full Case ★ modified
│       └── pages/
│           ├── ApplicantPortal.tsx  ← Public submission form + inline result display  ★ modified
│           ├── ChainOfThought.tsx   ← AI decision trace component                     ★ modified
│           ├── Dashboard.tsx        ← Caseworker case list
│           ├── CaseDetail.tsx       ← Full case view for caseworkers
│           └── ManagerQueue.tsx     ← Manager decline confirmation queue
├── test_data/
│   ├── TC-01-complete-tech/         ← Complete tech application (all 8 docs)
│   ├── TC-02-complete-nontech/      ← Complete non-tech (7 docs)
│   ├── TC-03-incomplete-one-missing/
│   ├── TC-04-incomplete-two-missing/
│   ├── TC-05-incomplete-missing-techq/
│   ├── TC-06-decline-basket/        ← 5+ missing docs → decline routing
│   ├── TC-07-name-mismatch/         ← Legal name differs across form/docs
│   ├── TC-08-budget-mismatch/       ← Requested amount exceeds worksheet total
│   ├── TC-09-date-out-of-window/    ← Project dates outside Apr 2026–Mar 2028
│   ├── TC-10-weak-funding-proof/    ← Funding letter missing forecast year
│   ├── TC-11-low-confidence/        ← Fields extracted with low confidence
│   └── TC-12-duplicate-uploads/     ← Duplicate files breaking classification
├── store/                           ← Local runtime case storage (JSON files)
├── vercel.json
└── CLAUDE.md                        ← THIS FILE
```

---

## 4. Data Models (schemas.py)

```python
class Case(BaseModel):
    case_id: str
    submission_timestamp: str          # ISO-8601
    status: str = "intake_pending"
    basket: Optional[Basket] = None    # complete | incomplete | decline_basket
    missing_count: int = 0
    missing_categories: List[str]
    documents: List[DocumentRecord]
    checklist: List[ChecklistItem]
    extracted_fields: Dict[str, ExtractedField]   # "DF-01" → ExtractedField
    eligibility_flags: List[EligibilityFlag]
    findings: List[Finding]
    email_draft: Optional[EmailDraft]
    manager_confirmed: bool
    manager_decision: Optional[str]
    audit_trail: List[AuditEvent]
    scenario_folder: Optional[str]

class ExtractedField(BaseModel):
    field_id: str                      # "DF-01" … "DF-07"
    name: str
    value: Optional[Any]
    source_doc_id: Optional[str]       # "DOC-01" etc.
    confidence: float                  # 0.0–1.0
    raw_excerpt: Optional[str]         # evidence string shown in UI
    manually_corrected: bool
    correction_history: List[Dict]

class Finding(BaseModel):
    id: str
    severity: Severity                 # error | warning | info | manual_review
    message: str
    rule_id: str                       # "R-001" … "R-009"
```

---

## 5. Document Types (DOC-01 to DOC-08)

| ID | Document | Required? |
|---|---|---|
| DOC-01 | Application Form (JSON auto-generated from portal) | Always |
| DOC-02 | Annual Financial Statements | Always |
| DOC-03 | Interim Financial Statements | Always |
| DOC-04 | Budget Worksheet / Cost Detail | Always |
| DOC-05 | Business Plan | Always |
| DOC-06 | Funding Confirmation Letter | Always |
| DOC-07 | Supplemental Form | Always |
| DOC-08 | Technology Questionnaire | Tech commercialization only |

---

## 6. Extracted Fields (DF-01 to DF-07)

| ID | Field | Source |
|---|---|---|
| DF-01 | Legal / Registered Company Name | application_form.json → cross-checked vs ALL docs |
| DF-02 | CRA Business Number | application_form.json |
| DF-03 | Incorporation Date | application_form.json |
| DF-04 | BC Operating Facilities | application_form.json |
| DF-05 | Requested PacifiCan Amount | application_form.json → cross-checked vs DOC-04 budget total |
| DF-06 | Non-RDA / Matching Funding | application_form.json |
| DF-07 | Project Start/End Dates | application_form.json |

---

## 7. Eligibility Rules (R-001 to R-009)

| Rule | Check | Outcome if failed |
|---|---|---|
| R-001 | BC Operating Facilities = true | error |
| R-002 | Name consistency: DF-01 matches across all submitted docs | warning/manual_review/info |
| R-003 | CRA number present and valid format (9 digits) | warning |
| R-004 | Incorporation date present | info |
| R-005 | Requested amount ≤ programme cap ($5M) | error |
| R-006 | Matching/non-RDA funding ≥ 50% of total project cost | warning |
| R-007 | Tech project must have DOC-08 (tech questionnaire) | error |
| R-008 | Non-tech project must NOT have DOC-08 | info |
| R-009 | Any extracted field with confidence < 60% → manual review | manual_review |

---

## 8. All Changes Made in This Session

### 8.1 Bug: `/apply` returned `extracted_fields: null`

**Root cause**: The original `/apply` endpoint returned only a 5-key summary dict
(`{case_id, basket, status, missing_count, message}`), never the full Case object.

**Fix in `backend/api/routes.py`**:
```python
@router.post("/apply")
async def submit_application(...) -> Dict[str, Any]:
    ...
    case = _run_full_pipeline(str(submission_dir))
    # json.loads(model_dump_json()) avoids Pydantic v2 Optional[Any] serialisation bug
    # where model_dump(mode="json") can return None for complex field values.
    return json.loads(case.model_dump_json())
```

Also: the `/apply` endpoint generates `application_form.json` in the nested structure the
extractor expects:
```python
app_form = {
    "organization": {
        "legal_name": applicant_name.strip(),
        "cra_business_number": cra_business_number.strip() or None,
        "incorporation_date": incorporation_date or None,
        "bc_operating_facilities": bc_facility,
        "corporate_status": org_type,
    },
    "project": {
        "address": {"province": province},
        "start_date": project_start or None,
        "end_date": project_end or None,
        "technology_commercialization": tech_comm,
    },
    "funding": {
        "total_rda_funding_requested": requested_amount,
        "total_non_rda_funding": matching_amount,
    },
}
```

**Pydantic v2 serialisation rule**: Always use `json.loads(case.model_dump_json())` not
`case.model_dump(mode="json")` when the model contains `Optional[Any]` fields.

---

### 8.2 Bug: R-002 showed green (passed) when no documents were submitted

**Root cause**: `_r002()` returned silently with no findings when DOC-07 and DOC-04 were
both absent — the UI interpreted "no findings" as "rule passed".

**Fix in `backend/intake/rules_engine.py`**:
```python
def _r002(findings, case, submission_folder, fields):
    supp_doc_present = False
    budget_doc_present = False

    # ... attempt to extract names from DOC-07 and DOC-04 ...

    # Case: no cross-documents at all → info finding (never silently green)
    if not supp_doc_present and not budget_doc_present:
        findings.append(Finding(
            id="R-002-no-cross-docs",
            rule_id="R-002",
            severity=Severity.info,
            message=(
                "Name consistency check SKIPPED — neither DOC-07 nor DOC-04 submitted. "
                f"Declared name '{app_name}' accepted from application form only."
            )
        ))
        return

    # Case: doc present but name could not be parsed → manual_review
    if supp_doc_present and not supp_name:
        findings.append(Finding(
            id="R-002-supp-extract-failed",
            rule_id="R-002",
            severity=Severity.manual_review,
            message="Legal name could not be parsed from supplemental form (DOC-07)..."
        ))

    # Case: names present and compared
    norm_app = _normalize_name(app_name)
    for doc_label, name in sources.items():
        if doc_label == "application form":
            continue
        if _normalize_name(name) != norm_app:
            findings.append(Finding(rule_id="R-002", severity=Severity.warning, ...))
```

---

### 8.3 Feature: DF-01 cross-checked against ALL uploaded documents

**Added to `backend/intake/extractor.py`**:

**New helper**: `_extract_org_name_from_pdf_header(filepath: str) -> Optional[str]`
- Reads PDF text, scans first ~20 lines
- Skips lines matching: "for", "page", "date", "prepared", "the period", "letter",
  "financial", "statement", "interim", "annual", "business plan", "bc tech", "award",
  "inc.", "ltd.", or lines starting with a digit
- Returns the first line that looks like a company name (contains Inc/Ltd/Corp/Systems/
  Defence/Technologies etc., or is ALL-CAPS)

**New function**: `_cross_check_df01(extracted, case, scenario_folder)`
- After form extraction, checks each submitted document for the organisation name:
  - DOC-07: `_extract_legal_name_from_supplemental()` (structured "LEGAL NAME:" parser)
  - DOC-04: `_extract_legal_name_from_budget()` (structured "Applicant:" row)
  - DOC-02, DOC-03, DOC-05, DOC-06: `_extract_org_name_from_pdf_header()`
- **Mismatch**: confidence × 0.40 → drops to ~39% (below R-009's 60% threshold → triggers manual review)
  raw_excerpt gets: `"[form value] | ⚠ CROSS-CHECK MISMATCH — DOC-07 says 'X'; DOC-02 says 'Y'"`
- **All match**: confidence unchanged
  raw_excerpt gets: `"[form value] | ✓ cross-checked: DOC-07 confirms 'X'; DOC-02 confirms 'X'"`
- **No cross-docs**: confidence unchanged
  raw_excerpt gets: `"[form value] | ℹ form declaration only — DOC-07 and DOC-04 not submitted"`

---

### 8.4 Feature: DF-05 cross-checked against DOC-04 budget worksheet total

**New function**: `_cross_check_df05(extracted, case, scenario_folder)`
**New helper**: `_read_budget_total(filepath: str) -> Optional[float]`
- Reads "Total Project Costs (Current)" from DOC-04 Cost Detail sheet

Logic:
- requested > budget_total: confidence × 0.45, raw_excerpt gets `"⚠ BUDGET MISMATCH — declared $X exceeds total $Y"`
- requested ≤ budget_total: raw_excerpt gets `"✓ budget cross-check: $X = Y% of worksheet total $Z"`
- DOC-04 absent: raw_excerpt gets `"ℹ form declaration only — DOC-04 not submitted"`

Both cross-checks are wired into `extract_fields()`:
```python
extracted = _cross_check_df01(extracted, case, scenario_folder)
extracted = _cross_check_df05(extracted, case, scenario_folder)
```

---

### 8.5 Frontend: ChainOfThought.tsx — Evidence display & confidence reasoning

**`extractConfidenceReason(field)` now detects cross-check signals**:
```typescript
function extractConfidenceReason(field: ExtractedField): string {
  const { confidence, raw_excerpt } = field;
  if (raw_excerpt?.includes("CROSS-CHECK MISMATCH"))
    return `Cross-check FAILED — name declared in application form does not match uploaded documents. Confidence dropped to ${Math.round(confidence * 100)}%...`;
  if (raw_excerpt?.includes("BUDGET MISMATCH"))
    return `Budget cross-check FAILED — declared PacifiCan request exceeds Total Project Costs in budget worksheet. Confidence dropped to ${Math.round(confidence * 100)}%...`;
  if (raw_excerpt?.includes("✓ cross-checked") || raw_excerpt?.includes("✓ budget cross-check"))
    return "Declared in application form AND independently confirmed by matching text in uploaded documents...";
  if (raw_excerpt?.includes("form declaration only"))
    return "Declared in application form only — supporting documents not submitted...";
  // ... existing confidence band logic ...
}
```

**`EvidenceBox` splits `raw_excerpt` on ` | ` into colour-coded lines**:
- Lines starting with `⚠` → red (#FCA5A5)
- Lines starting with `✓` → green (#86EFAC)
- Lines starting with `ℹ` → amber (#FCD34D)
- Other lines → blue (#93C5FD)

**Field summary rows show badges**: `⚠ MISMATCH` / `✓ VERIFIED` / `ℹ UNVERIFIED`

**`rulePassReason("R-002")` inspects the checklist**:
```typescript
case "R-002": {
  const doc07 = checklist.find(c => c.doc_id === "DOC-07");
  const doc04 = checklist.find(c => c.doc_id === "DOC-04");
  if (compared.length === 0)
    return `No cross-documents present — name consistency could not be verified...`;
  return `${appName} cross-checked against ${checkedStr} → all names consistent ✓`;
}
```

---

### 8.6 Frontend: ApplicantPortal.tsx — Key architecture decisions

- `submittedCase: Case | null` state (was previously two separate states)
- **No second `getCase()` call after submission** — critical for Vercel (each Lambda invocation
  gets its own empty `/tmp`; a second call would 404). The `/apply` response IS the full Case.
- `pacifican_facility` sent as string `"true"/"false"` to avoid FastAPI bool coercion issues
- Full inline form validation before submit: CRA format, amount range $1–$5M, date ordering,
  required name field

---

### 8.7 Frontend: api.ts

```typescript
// submitApplication returns the full Case — no second getCase() call needed
export const submitApplication = (formData: FormData) =>
  api.post<Case>("/apply", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
```

---

## 9. Git Commit History (most recent first)

```
2ac3abf  fix: cross-check all form-declared fields against every uploaded document
33e230c  fix: cross-check DF-01 legal name against uploaded documents during extraction
81cfa8b  fix: R-002 name consistency — replace false green pass with honest check status
15975bc  fix: return full Case from /apply so chain-of-thought has live extracted fields
110f712  fix: restore hasAppFormJson to component scope
2104b77  fix: wire intake form fields all the way through to pipeline extraction
4951ca8  fix: prefix unused matchedOn param with _ for TS strict
e4fcb46  feat: show full reasoning trail in chain-of-thought UI
58757ed  fix: remove unused variables in ChainOfThought.tsx (TS strict)
f9ceffb  feat: add Chain-of-Thought AI decision trace UI on applicant portal
```

---

## 10. Important Implementation Rules

1. **Pydantic v2 serialisation**: Always `json.loads(case.model_dump_json())` — never
   `case.model_dump(mode="json")` for `Optional[Any]` fields.

2. **Vercel / serverless**: Each Lambda invocation has its own empty `/tmp`. Never make a
   second API call expecting data saved by a previous call in the same user session.

3. **Immutable Pydantic updates**: Use `field.model_copy(update={...})` not direct assignment.

4. **R-002 must never be silently green**: If no cross-docs are present, emit an `info`
   severity finding. "No findings" = "rule passed" in the UI.

5. **R-009 fires automatically**: Any field with `confidence < 0.60` triggers a `manual_review`
   finding. Cross-check mismatches intentionally drop confidence below this threshold.

6. **`pacifican_facility` form field**: Send as string `"true"`/`"false"` from frontend.
   FastAPI Form() coercion is unreliable for booleans in multipart forms.

---

## 11. Pending / Next Steps

### Option A — Continue improving the prototype on Vercel (current stack)

Potential next features:
- [ ] Add R-010 through R-012 rules (see rules_engine.py for placeholders)
- [ ] Manager queue UI improvements (ManagerQueue.tsx)
- [ ] CaseDetail.tsx field correction UI
- [ ] Replace ephemeral `/tmp` with Vercel KV or external DB for persistent case storage
- [ ] Add authentication (NextAuth.js or Clerk)

### Option B — Migrate to Azure AI Foundry + Azure Container Apps (requested by user)

Full migration plan was designed in this session. Summary:

#### Target Architecture
```
Azure Subscription (Canada Central)
├── Azure AI Foundry Hub: rdii-foundry-hub
│   └── Project: rdii-intake-project
│       ├── Model: gpt4o-intake (GPT-4o 2024-11-20) — rules reasoning, routing
│       ├── Model: phi35-extractor (Phi-3.5-mini) — field extraction from PDF text
│       ├── Prompt Flow: field-extractor (replaces extractor.py)
│       ├── Prompt Flow: rules-evaluator (replaces rules_engine.py)
│       ├── Prompt Flow: case-router (replaces router.py)
│       └── Agent: rdii-intake-agent (orchestrates full pipeline)
├── Azure Container Apps Environment: rdii-env
│   ├── Container App: rdii-backend (FastAPI, calls Foundry flows)
│   ├── Container App: rdii-openwebui (OpenWebUI for caseworkers)
│   └── Container App: rdii-portal (React frontend for applicants)
├── Azure Blob Storage: rdii-submissions
│   └── {case_id}/application_form.json, {case_id}/DOC-07.pdf, etc.
├── Azure Cosmos DB: rdii (NoSQL)
│   ├── Container: cases (partition key: case_id)
│   └── Container: manager_queue
└── Azure Key Vault: rdii-foundry-kv
    ├── FOUNDRY_GPT4O_ENDPOINT / KEY
    ├── FOUNDRY_PHI35_ENDPOINT / KEY
    ├── COSMOS_ENDPOINT / KEY
    └── AZURE_STORAGE_CONNECTION_STRING
```

#### Migration Sequence (6 weeks)
1. **Week 1**: Azure infrastructure + containerise FastAPI backend + Blob/Cosmos DB
2. **Week 2**: Deploy OpenWebUI as Container App; connect to FastAPI passthrough endpoint
3. **Week 3**: Build Foundry Prompt Flows; run in parallel with Python pipeline; tune
4. **Week 4**: Cut backend over to Foundry flows; decommission Vercel
5. **Week 5**: Build `rdii-intake-agent`; wire as alternate path for complex cases
6. **Week 6**: Infra provisioner agent + CI/CD GitHub Actions pipeline

#### Key OpenWebUI Configuration
- `OPENAI_API_BASE_URL` → points to FastAPI backend's `/v1` endpoint (not OpenAI directly)
- FastAPI exposes `/v1/chat/completions` (OpenAI-compatible) for caseworker Q&A
- OpenWebUI custom tools: `lookup_case(case_id)` and `submit_application(form_data)`
- OpenWebUI is for **caseworkers only** — React portal stays for public applicants

#### AI-Assisted Infrastructure Provisioning
- All resources declared in `infra/main.bicep`
- Second Foundry agent `rdii-infra-agent` accepts natural language instructions
  (e.g. "spin up a staging environment with GPT-4o-mini") and generates/applies Bicep diffs
- Auto-scaler Prompt Flow: reads Cosmos DB queue depth → calls Container Apps management API

#### Data Residency
- All resources in `Canada Central` — meets PBMM (Protected B) requirements for Canadian federal agencies

---

## 12. How to Run Locally

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
# Vite proxy in vite.config.ts routes /api → localhost:8000
```

Environment variables needed for Azure migration (not needed for local/Vercel):
```
FOUNDRY_GPT4O_ENDPOINT=
FOUNDRY_GPT4O_KEY=
FOUNDRY_PHI35_ENDPOINT=
FOUNDRY_PHI35_KEY=
COSMOS_ENDPOINT=
COSMOS_KEY=
AZURE_STORAGE_CONNECTION_STRING=
STORE_DIR=/tmp/rdii-store   # override default store location
TEST_DATA_DIR=./test_data
UPLOAD_DIR=/tmp/rdii-uploads
```

---

## 13. Key Files to Read First

When starting a new session in this project, read these files in order:

1. `backend/models/schemas.py` — all data models
2. `backend/api/routes.py` — all endpoints, especially `_run_full_pipeline()` and `/apply`
3. `backend/intake/extractor.py` — field extraction + cross-checks
4. `backend/intake/rules_engine.py` — R-001 through R-009
5. `frontend/src/pages/ChainOfThought.tsx` — AI decision trace UI
6. `frontend/src/pages/ApplicantPortal.tsx` — applicant submission portal
7. `frontend/src/api.ts` — API client

---

*Generated: 2026-05-28 — covers all development work from session cc7bec1c through the Azure migration design session.*

---

## 14. Session Update (2026-06-02) — LLM/Skills-Based Extraction + Azure Foundry

This session migrated field extraction from deterministic Python to a **skills-driven,
LLM-first** design pointed at an **Azure AI Foundry** GPT deployment.

### 14.1 What changed

- **`backend/intake/skills.json`** (NEW) — the ONLY domain-specific artifact. 7 field skills
  (DF-01…DF-07), each with `extraction_prompt`, `type`, `required`, `confidence_default`, and
  cross-check config. Swap this file to change domains — no code change needed.
- **`backend/intake/extractor.py`** (REWRITTEN) — now skills-driven and LLM-first:
  1. load skills → 2. build a universal document bundle (PDF/JSON/XLSX/text all read to text)
  → 3. one GPT call extracts all fields (`response_format=json_object`, temp 0)
  → 4. LLM cross-checks (DF-01 name across docs; Python only compares) → 5. budget cross-check
  (DF-05 vs DOC-04 total via openpyxl — binary Excel can't go to a text LLM) → 6. TC-11 overrides
  → 7. placeholders. Audit event records `gpt_assisted`, `gpt_model`, `skills_loaded`.
- **`backend/requirements.txt`** — added `openai==1.52.0`.
- **`.gitignore`** — added `.env`, `.env.*`, `*.env` (secrets never committed).
- **`backend/.env.local`** (NEW, GITIGNORED) — holds the Foundry secret locally only:
  ```
  OPENAI_API_KEY=<set locally, never committed>
  OPENAI_BASE_URL=https://rdiivercel.services.ai.azure.com/openai/v1
  GPT_MODEL=gpt-4.1
  ```
- **`backend/test_extraction_local.py`** (NEW) — local harness. `--smoke` checks Foundry
  connectivity; default runs every TC scenario twice (key hidden = legacy baseline, key on =
  GPT path) and prints a field-by-field diff. Masks the key in all output.

### 14.2 Azure AI Foundry config

- OpenAI SDK pointed at Foundry via `OPENAI_BASE_URL` (OpenAI-compatible endpoint).
- `GPT_MODEL` = the Foundry **deployment name** (`gpt-4.1`), passed as the `model` param.
- `_make_client()` in extractor.py uses `base_url` when `OPENAI_BASE_URL` is set.

### 14.3 OPEN DIRECTIVE (in progress, not yet done)

User directive: **all tests must run through the GPT model path; no deterministic rules-based
Python may be used to fetch fields or check completeness — but every PRD feature must still work.**

Concretely this means:
- `extractor.py`: GPT must be the path exercised by tests (the legacy fallback is for the
  no-key safety net only; with the Foundry key set, extraction goes entirely through GPT).
- `classifier.py` (CURRENTLY fully deterministic filename/content heuristics → builds the
  completeness checklist DOC-01…DOC-08): the **completeness check must become LLM/skill-based**.
  This rewrite was NOT yet done — `classifier.py` is still the regex/heuristic version.
- Must preserve: checklist statuses (present/uncertain/missing/not_applicable), DOC-08 tech
  gating, cross-checks, budget check, R-001…R-009 rules, routing, manager queue, email drafts.

### 14.4 Current status / next steps

- [ ] Set the real Foundry key in `backend/.env.local` (placeholder still present as of writing).
- [ ] Run `python3 test_extraction_local.py --smoke` then full comparison across 12 TCs.
- [ ] Rewrite `classifier.py` to be LLM/skill-based for completeness (see 14.3).
- [ ] Optionally make extraction GPT-only (drop silent legacy fallback) per the directive.
- [ ] After local verification: set `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`GPT_MODEL` on Vercel and deploy.

*Updated: 2026-06-02 — GPT/Foundry extraction migration + pending full-LLM completeness directive.*
