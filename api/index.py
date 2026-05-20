"""
Vercel Python serverless function entry point.
Vercel looks for a callable named `app` in api/index.py.
We add backend/ to sys.path so all relative imports in main.py work.
"""
import sys
import os
from pathlib import Path

# Make backend/ importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

# Point STORE_DIR to /tmp (writable on Vercel)
os.environ.setdefault("STORE_DIR", "/tmp/rdii-store")

# Uploads go to /tmp as well
os.environ.setdefault("UPLOAD_DIR", "/tmp/rdii-uploads")

# test_data ships with the repo; Vercel bundles it at build time
os.environ.setdefault(
    "TEST_DATA_DIR",
    str(Path(__file__).parent.parent / "test_data"),
)

from main import app  # noqa: E402 — must come after sys.path manipulation
