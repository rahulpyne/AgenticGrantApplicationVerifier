import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCases, submitCase } from "../api";
import type { Case } from "../api";

const SCENARIOS = [
  "TC-01-complete-tech",
  "TC-02-complete-nontech",
  "TC-03-incomplete-one-missing",
  "TC-04-incomplete-two-missing",
  "TC-05-incomplete-missing-techq",
  "TC-06-decline-basket",
  "TC-07-name-mismatch",
  "TC-08-budget-mismatch",
  "TC-09-date-out-of-window",
  "TC-10-weak-funding-proof",
  "TC-11-low-confidence",
  "TC-12-duplicate-uploads",
];

function BasketChip({ basket }: { basket: string | null }) {
  if (!basket) return <span className="chip" style={{ background: "#F3F4F6", color: "#6B7280" }}>Pending</span>;
  const label = basket === "decline_basket" ? "Decline Basket" : basket.charAt(0).toUpperCase() + basket.slice(1);
  return <span className={`chip chip-${basket}`}>{label}</span>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function getApplicantName(c: Case & { applicant_name?: string }): string {
  // Summary endpoint returns applicant_name at top level
  if ((c as { applicant_name?: string }).applicant_name) return (c as { applicant_name?: string }).applicant_name!;
  const df01 = c.extracted_fields?.["DF-01"];
  if (df01?.value && typeof df01.value === "string") return df01.value;
  return "—";
}

type CaseSummary = Case & { applicant_name?: string; findings_count?: number };

function getWarningCount(c: CaseSummary): number {
  if (c.findings_count !== undefined) return c.findings_count;
  return (c.findings || []).filter((f) => ["warning", "error", "manual_review"].includes(f.severity)).length;
}

export default function Dashboard() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getCases()
      .then(setCases)
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(selected);
    setError(null);
    try {
      await submitCase(selected);
      load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Submission failed";
      setError(msg);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2" style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Application Intake Dashboard</h1>
        <div className="flex gap-2 items-center">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: 280 }}>
            <option value="">— Select test scenario —</option>
            {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!selected || !!submitting}
          >
            {submitting ? "Processing…" : "Submit Scenario"}
          </button>
          <button className="btn-secondary" onClick={load}>Refresh</button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>⚠</span> {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          All Cases ({cases.length})
        </div>
        {loading ? (
          <div className="card-body text-muted">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="card-body text-muted">No cases yet. Submit a test scenario above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Applicant</th>
                <th>Submitted</th>
                <th>Basket</th>
                <th>Findings</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.slice().reverse().map((c) => (
                <tr key={c.case_id}>
                  <td><code style={{ fontSize: 12 }}>{c.case_id}</code></td>
                  <td className="fw-600">{getApplicantName(c)}</td>
                  <td className="text-sm text-muted">{formatDate(c.submission_timestamp)}</td>
                  <td><BasketChip basket={c.basket} /></td>
                  <td>
                    {getWarningCount(c) > 0
                      ? <span style={{ color: "#D97706" }}>⚠ {getWarningCount(c)}</span>
                      : <span className="text-muted">—</span>
                    }
                  </td>
                  <td className="text-sm">{c.status.replace(/_/g, " ")}</td>
                  <td>
                    <Link to={`/cases/${c.case_id}`}>
                      <button className="btn-secondary" style={{ padding: "4px 12px", fontSize: 13 }}>
                        Review →
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
