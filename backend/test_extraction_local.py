"""
Local extraction test harness — Azure AI Foundry GPT path vs. legacy fallback.

Usage (from the backend/ directory):

    # 1. Smoke test only — confirms the Foundry endpoint + key work at all
    python test_extraction_local.py --smoke

    # 2. Full field-by-field comparison across scenarios (GPT on vs. fallback)
    python test_extraction_local.py

    # 3. A single scenario
    python test_extraction_local.py --only TC-01-complete-tech

Reads backend/.env.local for OPENAI_API_KEY / OPENAI_BASE_URL / GPT_MODEL.
Nothing here is committed and no secret is ever printed.
"""

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.resolve()
TEST_DATA_DIR = BACKEND_DIR.parent / "test_data"


# ---------------------------------------------------------------------------
# .env.local loader (no external dependency on python-dotenv)
# ---------------------------------------------------------------------------
def load_env_local() -> None:
    env_path = BACKEND_DIR / ".env.local"
    if not env_path.exists():
        print(f"!! No .env.local at {env_path}")
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ[key.strip()] = val.strip()


def mask(secret: str) -> str:
    if not secret:
        return "(empty)"
    if len(secret) <= 8:
        return "****"
    return secret[:4] + "…" + secret[-4:]


# ---------------------------------------------------------------------------
# Connectivity smoke test against the Foundry endpoint
# ---------------------------------------------------------------------------
def smoke_test() -> bool:
    from openai import OpenAI

    base_url = os.environ.get("OPENAI_BASE_URL", "")
    api_key = os.environ.get("OPENAI_API_KEY", "")
    model = os.environ.get("GPT_MODEL", "gpt-4.1")

    print("Foundry config:")
    print(f"  base_url = {base_url or '(default OpenAI)'}")
    print(f"  model    = {model}")
    print(f"  api_key  = {mask(api_key)}")

    if not api_key or api_key == "PASTE_YOUR_KEY_HERE":
        print("\n!! OPENAI_API_KEY is not set (still the placeholder).")
        print("   Paste your key into backend/.env.local then rerun.")
        return False

    client = OpenAI(base_url=base_url, api_key=api_key) if base_url else OpenAI(api_key=api_key)
    print("\nCalling the model …")
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "What is the capital of France? One word."}],
        temperature=0,
        max_tokens=10,
    )
    answer = resp.choices[0].message.content.strip()
    print(f"  -> {answer!r}")
    ok = "paris" in answer.lower()
    print("  Smoke test:", "PASS" if ok else "UNEXPECTED ANSWER (but connection worked)")
    return True


# ---------------------------------------------------------------------------
# Run extraction for one scenario, return {DF-xx: ExtractedField}
# ---------------------------------------------------------------------------
def run_scenario(folder: Path):
    sys.path.insert(0, str(BACKEND_DIR))
    from intake import trigger, ingestion, classifier, extractor

    resolved = str(folder)
    case = trigger.create_case(resolved)
    case = ingestion.ingest_documents(case, resolved)
    case = classifier.classify_documents(case, resolved)
    case = extractor.extract_fields(case, resolved)
    return case


def field_summary(ef) -> str:
    val = ef.value
    if isinstance(val, str) and len(val) > 40:
        val = val[:37] + "…"
    return f"{val!r} (conf {ef.confidence:.2f}, src {ef.source_doc_id})"


def compare(folder_name: str):
    """Run once with GPT off (baseline), once with GPT on, and diff."""
    folder = TEST_DATA_DIR / folder_name

    # --- baseline: force fallback by hiding the key for this run ---
    saved_key = os.environ.get("OPENAI_API_KEY", "")
    os.environ["OPENAI_API_KEY"] = ""
    _reload_extractor()
    base_case = run_scenario(folder)
    base = base_case.extracted_fields

    # --- GPT path ---
    os.environ["OPENAI_API_KEY"] = saved_key
    _reload_extractor()
    gpt_case = run_scenario(folder)
    gpt = gpt_case.extracted_fields

    print(f"\n{'='*78}\n{folder_name}")
    print(f"  basket: fallback={base_case.basket}  gpt={gpt_case.basket}")
    gpt_audit = [a for a in gpt_case.audit_trail if "gpt" in str(a.model_dump()).lower()]
    if gpt_audit:
        print(f"  gpt audit: {gpt_audit[-1].model_dump()}")
    print(f"  {'field':<8}{'fallback':<44}{'gpt'}")
    all_ids = sorted(set(base) | set(gpt))
    diffs = 0
    for fid in all_ids:
        b = base.get(fid)
        g = gpt.get(fid)
        bstr = field_summary(b) if b else "—"
        gstr = field_summary(g) if g else "—"
        mark = "  " if (b and g and str(b.value) == str(g.value)) else "≠ "
        if mark == "≠ ":
            diffs += 1
        print(f"  {mark}{fid:<6}{bstr:<44}{gstr}")
    print(f"  value diffs: {diffs}")
    return diffs


def _reload_extractor():
    """Drop cached extractor module so the new env var is picked up."""
    for mod in list(sys.modules):
        if mod.startswith("intake"):
            del sys.modules[mod]


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="only run connectivity smoke test")
    ap.add_argument("--only", help="run a single scenario folder name")
    args = ap.parse_args()

    load_env_local()

    if not smoke_test():
        sys.exit(1)
    if args.smoke:
        return

    if args.only:
        scenarios = [args.only]
    else:
        scenarios = sorted(p.name for p in TEST_DATA_DIR.iterdir() if p.is_dir())

    total_diffs = 0
    for s in scenarios:
        total_diffs += compare(s)

    print(f"\n{'='*78}\nTOTAL value diffs across {len(scenarios)} scenarios: {total_diffs}")
    print("(value diffs are expected where GPT reads richer evidence than the regex "
          "fallback — review each ≠ row to confirm GPT is at least as correct.)")


if __name__ == "__main__":
    main()
