# RDII Application Intake Triage — Prototype

Automated first-pass review system for PacifiCan's Regional Defence Investment Initiative (RDII) grant applications. Classifies incoming application packages into **Complete**, **Incomplete**, or **Decline Basket** based on document completeness and cross-document rule checks.

---

## Architecture

```
rdii-prototype/
├── backend/            FastAPI backend (Python 3.13)
│   ├── main.py         App entry point, CORS, startup
│   ├── api/routes.py   REST API endpoints
│   ├── intake/         Pipeline modules (trigger → ingest → classify → extract → rules → route)
│   ├── comms/          Email draft + manager queue
│   ├── models/         Pydantic schemas
│   └── store/          JSON-backed case store
├── frontend/           React 18 + TypeScript (Vite)
│   └── src/pages/      Dashboard + CaseDetail officer workspace
├── test_data/          12 synthetic scenario packages
├── tests/
│   ├── run_all_scenarios.py   Submits all 12 scenarios, prints pass/fail table
│   └── assert_scenarios.py   Asserts basket, missing count, rule IDs, email draft presence
└── generate_test_data.py     Regenerates all 12 test packages
```

---

## Prerequisites

- Python 3.13 with `pip`
- Node 18+ with `npm`

---

## Setup & Run

### 1. Backend

```bash
cd rdii-prototype/backend
pip install -r requirements.txt
python main.py          # or: uvicorn main:app --reload --port 8000
```

Backend serves at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd rdii-prototype/frontend
npm install
npm run dev             # serves at http://localhost:5177
```

Vite proxies `/api/*` to `localhost:8000`.

### 3. Generate test data (if needed)

```bash
cd rdii-prototype
python generate_test_data.py
```

---

## Running Tests

Both scripts require the backend to be running (`python main.py`).

```bash
cd rdii-prototype

# Quick results table (basket routing only)
python tests/run_all_scenarios.py

# Full assertions (basket, missing count, rule IDs, email draft, manager queue)
python tests/assert_scenarios.py
```

Expected output: `12/12 assertions passed` / exit code 0.

---

## Test Scenarios

| TC | Description | Expected Basket | Key Rule |
|----|-------------|-----------------|----------|
| TC-01 | Complete tech application | complete | — |
| TC-02 | Complete non-tech application | complete | — |
| TC-03 | 1 missing doc (funding confirmation) | incomplete | — |
| TC-04 | 2 missing docs | incomplete | — |
| TC-05 | Missing tech questionnaire (tech project) | incomplete | R-007 TRL |
| TC-06 | 5 missing docs | decline\_basket | R-007, R-008 |
| TC-07 | Legal name mismatch across documents | complete | R-002 |
| TC-08 | Budget total mismatch | complete | R-003 |
| TC-09 | Project dates outside window | complete | R-004 |
| TC-10 | No forecast year in funding letter | complete | R-010 |
| TC-11 | Low-confidence field extraction | complete | R-009 |
| TC-12 | Duplicate file uploads | incomplete | — |

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/cases/submit` | Run full intake pipeline for a scenario folder |
| `GET` | `/api/v1/cases` | List all cases (summary) |
| `GET` | `/api/v1/cases/{id}` | Full case detail |
| `PATCH` | `/api/v1/cases/{id}/fields/{field_id}` | Officer field correction (requires `reason_note`) |
| `PATCH` | `/api/v1/cases/{id}/documents/{doc_id}/type` | Document type override (requires `reason_note`) |
| `GET` | `/api/v1/cases/{id}/email-draft` | Get draft email |
| `PATCH` | `/api/v1/cases/{id}/email-draft` | Edit email subject/body |
| `POST` | `/api/v1/cases/{id}/email-draft/mark-reviewed` | Mark email reviewed (officer) |
| `POST` | `/api/v1/cases/{id}/email-draft/send` | Send email — **403 if not reviewed** |
| `POST` | `/api/v1/cases/{id}/manager-decision` | Manager confirm/return/override (requires `comment`) |
| `GET` | `/api/v1/manager/queue` | Decline basket cases pending manager review |
| `GET` | `/api/v1/cases/{id}/audit` | Full audit trail |

---

## Guardrails

- **Email send**: HTTP 403 if no `email_reviewed` event in audit trail. Officer must explicitly mark the draft as reviewed before sending.
- **Field corrections**: HTTP 400 if `reason_note` is empty. All corrections are audit-logged.
- **Manager decisions**: HTTP 400 if `comment` is empty. Required for confirm / return / override actions on decline basket cases.
- **No auto-send**: The system never sends emails or issues decline notices autonomously. All outbound actions require explicit officer or manager action.
