"""
Assert exact expected outcomes for all 12 RDII test scenarios.
Usage: python assert_scenarios.py
Exit code 0 = all assertions pass, 1 = failures.
"""
import sys
import requests
from pathlib import Path

BASE_URL = "http://localhost:8000/api/v1"
TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"

# Each entry: (basket, missing_count_min, expected_rule_ids, required_email_draft, notes)
ASSERTIONS = {
    "TC-01": {
        "basket": "complete",
        "missing_count": 0,
        "no_rules": True,
        "email_draft": False,
        "desc": "Complete tech application — all 8 docs present, no findings",
    },
    "TC-02": {
        "basket": "complete",
        "missing_count": 0,
        "no_rules": True,
        "email_draft": False,
        "desc": "Complete non-tech application — all docs present, DOC-08 N/A",
    },
    "TC-03": {
        "basket": "incomplete",
        "missing_count_min": 1,
        "no_rules": True,
        "email_draft": True,
        "desc": "1 missing doc (funding confirmation) → incomplete, email draft generated",
    },
    "TC-04": {
        "basket": "incomplete",
        "missing_count_min": 2,
        "no_rules": True,
        "email_draft": True,
        "desc": "2 missing docs → incomplete, email draft generated",
    },
    "TC-05": {
        "basket": "incomplete",
        "missing_count_min": 1,
        "rule_ids": ["R-007"],
        "email_draft": True,
        "desc": "Missing tech questionnaire (tech project) → incomplete + R-007 TRL warning",
    },
    "TC-06": {
        "basket": "decline_basket",
        "missing_count_min": 3,
        "rule_ids": ["R-007", "R-008"],
        "email_draft": False,
        "manager_queue": True,
        "desc": "5+ missing docs → decline basket, manager queue, R-007+R-008 findings",
    },
    "TC-07": {
        "basket": "complete",
        "missing_count": 0,
        "rule_ids": ["R-002"],
        "email_draft": False,
        "desc": "Name mismatch across documents → R-002 warning finding",
    },
    "TC-08": {
        "basket": "complete",
        "missing_count": 0,
        "rule_ids": ["R-003"],
        "email_draft": False,
        "desc": "Budget mismatch between app form and worksheet → R-003 warning",
    },
    "TC-09": {
        "basket": "complete",
        "missing_count": 0,
        "rule_ids": ["R-004"],
        "email_draft": False,
        "desc": "Project dates outside eligible window → R-004 warning",
    },
    "TC-10": {
        "basket": "complete",
        "missing_count": 0,
        "rule_ids": ["R-010"],
        "email_draft": False,
        "desc": "Weak funding proof (no forecast year) → R-010 warning",
    },
    "TC-11": {
        "basket": "complete",
        "rule_ids": ["R-009"],
        "email_draft": False,
        "desc": "Low-confidence extraction on key fields → R-009 manual review findings",
    },
    "TC-12": {
        "basket": "incomplete",
        "missing_count_min": 1,
        "no_rules": True,
        "email_draft": True,
        "desc": "Duplicate file uploads — checklist still detects missing category",
    },
}

TC_ORDER = [f"TC-{i:02d}" for i in range(1, 13)]


def _folder_for(tc_id: str) -> Path:
    for d in sorted(TEST_DATA_DIR.iterdir()):
        if d.is_dir() and d.name.startswith(tc_id):
            return d
    raise FileNotFoundError(f"No test folder found for {tc_id}")


def _submit(tc_id: str) -> dict:
    folder = _folder_for(tc_id)
    resp = requests.post(
        f"{BASE_URL}/cases/submit",
        json={"scenario_folder": str(folder)},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _assert_case(tc_id: str, case: dict, spec: dict) -> list[str]:
    """Return list of failure messages (empty = pass)."""
    failures = []
    actual_basket = case.get("basket")
    findings = case.get("findings", [])
    actual_rule_ids = {f["rule_id"] for f in findings}
    warn_severities = {"warning", "error", "manual_review"}
    warn_findings = [f for f in findings if f.get("severity") in warn_severities]

    # Basket
    if actual_basket != spec["basket"]:
        failures.append(f"basket: expected {spec['basket']!r}, got {actual_basket!r}")

    # Exact missing count
    if "missing_count" in spec:
        mc = case.get("missing_count", -1)
        if mc != spec["missing_count"]:
            failures.append(f"missing_count: expected {spec['missing_count']}, got {mc}")

    # Minimum missing count
    if "missing_count_min" in spec:
        mc = case.get("missing_count", -1)
        if mc < spec["missing_count_min"]:
            failures.append(f"missing_count: expected >= {spec['missing_count_min']}, got {mc}")

    # Expected rule IDs present
    for rule_id in spec.get("rule_ids", []):
        if rule_id not in actual_rule_ids:
            failures.append(f"expected rule {rule_id!r} in findings, got {sorted(actual_rule_ids)}")

    # No warning findings expected
    if spec.get("no_rules"):
        if warn_findings:
            failures.append(f"expected no warning findings, got {[f['rule_id'] for f in warn_findings]}")

    # Email draft
    has_draft = case.get("email_draft") is not None
    if spec.get("email_draft") and not has_draft:
        failures.append("expected email_draft to be present, but it is None")
    if not spec.get("email_draft") and has_draft:
        failures.append("expected no email_draft, but one was generated")

    # Manager queue (spot-check via queue endpoint)
    if spec.get("manager_queue"):
        try:
            q_resp = requests.get(f"{BASE_URL}/manager/queue", timeout=10)
            queue_ids = {item["case_id"] for item in q_resp.json()}
            if case["case_id"] not in queue_ids:
                failures.append(f"case {case['case_id']!r} not found in manager queue")
        except Exception as exc:
            failures.append(f"could not check manager queue: {exc}")

    return failures


def run():
    total = 0
    passed = 0
    all_failures: list[tuple[str, list[str]]] = []

    print(f"\n{'TC':<8} {'Basket':<16} {'Findings':<10} {'Result'}")
    print("-" * 70)

    for tc_id in TC_ORDER:
        spec = ASSERTIONS[tc_id]
        total += 1
        try:
            case = _submit(tc_id)
            failures = _assert_case(tc_id, case, spec)
            findings = case.get("findings", [])
            warn_count = sum(1 for f in findings if f.get("severity") in {"warning", "error", "manual_review"})

            if not failures:
                passed += 1
                print(f"✓ {tc_id:<6} {case.get('basket', '?'):<16} {warn_count:<10} PASS")
            else:
                print(f"✗ {tc_id:<6} {case.get('basket', '?'):<16} {warn_count:<10} FAIL")
                all_failures.append((tc_id, failures))
        except Exception as exc:
            print(f"✗ {tc_id:<6} {'ERROR':<16} {'?':<10} FAIL")
            all_failures.append((tc_id, [f"Exception: {exc}"]))

    print(f"\n{passed}/{total} assertions passed")

    if all_failures:
        print("\nFailure details:")
        for tc_id, msgs in all_failures:
            spec = ASSERTIONS[tc_id]
            print(f"\n  {tc_id} — {spec['desc']}")
            for msg in msgs:
                print(f"    ✗ {msg}")

    return passed == total


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
