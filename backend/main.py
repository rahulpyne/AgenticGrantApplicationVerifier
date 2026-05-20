"""
RDII Intake Triage System — FastAPI application entry point.
Run with: uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import sys
import os
from pathlib import Path

# Ensure backend/ directory is on sys.path so relative module imports work
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from store import case_store as _cs

# Ensure storage directories exist on startup.
# On Vercel the filesystem is read-only except /tmp, so default STORE_DIR there.
import os as _os
_default_store = "/tmp/rdii-store" if _os.environ.get("VERCEL") else str(Path(__file__).parent.parent / "store")
STORE_DIR = Path(_os.environ.get("STORE_DIR", _default_store))
STORE_DIR.mkdir(parents=True, exist_ok=True)
(STORE_DIR / "cases").mkdir(exist_ok=True)
manager_queue_file = STORE_DIR / "manager_queue.json"
if not manager_queue_file.exists():
    manager_queue_file.write_text("[]")

app = FastAPI(
    title="RDII Application Intake Triage API",
    description="PacifiCan RDII grant application intake triage prototype",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "rdii-intake-triage"}
