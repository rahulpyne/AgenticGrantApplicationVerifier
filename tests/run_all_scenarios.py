"""
Run all 12 scenarios against the backend and print a results table.
Usage: python run_all_scenarios.py
"""
import sys
import json
import requests
from pathlib import Path

BASE_URL = "http://localhost:8000/api/v1"
TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"

EXPECTED = {
    "TC-01": "complete",
    "TC-02": "complete",
    "TC-03": "incomplete",
    "TC-04": "incomplete",
    "TC-05": "incomplete",
    "TC-06": "decline_basket",
    "TC-07": "complete",
    "TC-08": "complete",
    "TC-09": "complete",
    "TC-10": "complete",
    "TC-11": "complete",
    "TC-12": "incomplete",
}

TC_ORDER = ["TC-01", "TC-02", "TC-03", "TC-04", "TC-05", "TC-06",
            "TC-07", "TC-08", "TC-09", "TC-10", "TC-11", "TC-12"]


def _folder_for(tc_id: str) -> Path:
    for d in sorted(TEST_DATA_DIR.iterdir()):
        if d.is_dir() and d.name.startswith(tc_id):
            return d
    raise FileNotFoundError(f"No test folder found for {tc_id}")


def run_all():
    results = []
    for tc_id in TC_ORDER:
        expected = EXPECTED[tc_id]
        try:
            folder = _folder_for(tc_id)
            resp = requests.post(
                f"{BASE_URL}/cases/submit",
                json={"scenario_folder": str(folder)},
                timeout=30,
            )
            resp.raise_for_status()
            case = resp.json()
            actual = case.get("basket", "unknown")
            findings = case.get("findings", [])
            warnings = [f for f in findings if f.get("severity") in ("warning", "manual_review")]
            status = "PASS" if actual == expected else "FAIL"
            results.append((tc_id, expected, actual, status, len(warnings), case.get("case_id", "?")))
        except Exception as e:
            results.append((tc_id, expected, f"ERROR: {e}", "FAIL", 0, "-"))

    # Print table
    header = f"{'TC':<8} {'Expected':<16} {'Actual':<16} {'Result':<6} {'Findings':<10} Case ID"
    print("\n" + header)
    print("-" * 80)
    for tc_id, exp, act, status, nw, cid in results:
        marker = "✓" if status == "PASS" else "✗"
        print(f"{marker} {tc_id:<6} {exp:<16} {act:<16} {status:<6} {nw:<10} {cid}")

    passed = sum(1 for r in results if r[3] == "PASS")
    total = len(results)
    print(f"\n{passed}/{total} scenarios passed")
    return passed == total


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
