"""
Usage: python load_scenario.py <scenario_folder_path_or_name>
Submits one scenario to the backend and prints a summary.
"""
import sys
import json
import requests

BASE_URL = "http://localhost:8000/api/v1"


def load_scenario(scenario: str) -> dict:
    resp = requests.post(f"{BASE_URL}/cases/submit", json={"scenario_folder": scenario})
    resp.raise_for_status()
    return resp.json()


def summarise(case: dict) -> None:
    ef = case.get("extracted_fields", {})
    name = (ef.get("DF-01") or {}).get("value", "Unknown")
    basket = case.get("basket", "unknown")
    findings = case.get("findings", [])
    warnings = [f for f in findings if f.get("severity") in ("warning", "error")]
    checklist = case.get("checklist", [])
    missing = [c["doc_id"] for c in checklist if c["status"] == "missing"]
    uncertain = [c["doc_id"] for c in checklist if c["status"] == "uncertain"]

    print(f"\nCase ID  : {case.get('case_id')}")
    print(f"Applicant: {name}")
    print(f"Basket   : {basket.upper()}")
    print(f"Missing  : {missing if missing else 'None'}")
    print(f"Uncertain: {uncertain if uncertain else 'None'}")
    print(f"Warnings : {len(warnings)}")
    for w in warnings:
        print(f"  [{w['severity'].upper()}] {w['message']}")
    if case.get("email_draft"):
        print(f"Email draft: {'reviewed' if case['email_draft']['reviewed'] else 'pending review'}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python load_scenario.py <scenario_folder>")
        sys.exit(1)
    case = load_scenario(sys.argv[1])
    summarise(case)
