import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getCase,
  getTestPackages,
  submitApplication,
  testPackageDownloadUrl,
} from "../api";
import type { Case, TestPackage } from "../api";
import ChainOfThought from "./ChainOfThought";

const REQUIRED_DOCS = [
  { id: "DOC-02", label: "Annual Financial Statements", hint: "Last 2 fiscal years", ext: "PDF" },
  { id: "DOC-03", label: "Interim Financial Statements", hint: "Current year to date", ext: "PDF" },
  { id: "DOC-04", label: "Budget Worksheet", hint: "Cost detail by category", ext: "XLSX" },
  { id: "DOC-05", label: "Business Plan / Pitch Deck", hint: "Project overview and objectives", ext: "PDF" },
  { id: "DOC-06", label: "Funding Confirmation Letter", hint: "From all non-PacifiCan sources", ext: "PDF" },
  { id: "DOC-07", label: "RDI Mandatory Supplemental Form", hint: "Completed PacifiCan supplemental", ext: "PDF" },
  { id: "DOC-08", label: "RDI Technology Questionnaire", hint: "Required for tech commercialization projects only", ext: "PDF" },
];

const PROVINCES = ["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"];
const ORG_TYPES = [
  { value: "for-profit",    label: "For-Profit Corporation (Inc. / Ltd.)" },
  { value: "non-profit",    label: "Non-Profit / Society" },
  { value: "partnership",   label: "Partnership" },
  { value: "sole-proprietor", label: "Sole Proprietor" },
  { value: "cooperative",   label: "Cooperative" },
];

// Validation helpers
const CRA_RE = /^\d{9}$/;
function validateCra(v: string) {
  if (!v) return null; // optional
  return CRA_RE.test(v.replace(/\s|-/g, "")) ? null : "Must be exactly 9 digits (e.g. 123456789)";
}
function validateAmount(v: string, min: number, max: number, label: string) {
  const n = parseFloat(v);
  if (!v || isNaN(n)) return `${label} is required`;
  if (n < min) return `Must be ≥ $${min.toLocaleString()}`;
  if (n > max) return `Must be ≤ $${max.toLocaleString()}`;
  return null;
}
function validateDates(start: string, end: string) {
  if (!start || !end) return null;
  return new Date(start) < new Date(end) ? null : "Start date must be before end date";
}

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BasketBadge({ basket }: { basket: Case["basket"] }) {
  if (basket === "complete")
    return <span className="chip chip-complete">Complete</span>;
  if (basket === "incomplete")
    return <span className="chip chip-incomplete">Incomplete</span>;
  if (basket === "decline_basket")
    return <span className="chip chip-decline_basket">Under Review</span>;
  return null;
}

export default function ApplicantPortal() {
  // Form fields
  const [applicantName, setApplicantName] = useState("");
  const [craNumber, setCraNumber] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [province, setProvince] = useState("BC");
  const [pacificanFacility, setPacificanFacility] = useState("true");
  const [projectType, setProjectType] = useState("non_tech");
  const [orgType, setOrgType] = useState("for-profit");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [matchingAmount, setMatchingAmount] = useState("");
  const [projectStart, setProjectStart] = useState("");
  const [projectEnd, setProjectEnd] = useState("");

  // Inline validation errors (shown on blur / submit attempt)
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched(p => ({ ...p, [field]: true }));

  // Soft range warning (not blocking) for matching funds
  const matchingWarn = matchingAmount && requestedAmount
    ? (() => {
        const rda = parseFloat(requestedAmount);
        const other = parseFloat(matchingAmount);
        if (!isNaN(rda) && !isNaN(other) && rda + other > 0) {
          const share = rda / (rda + other);
          if (share > 0.75) return `PacifiCan share is ${(share * 100).toFixed(1)}% — exceeds the 75% limit (R-005 will flag this)`;
        }
        return null;
      })()
    : null;

  // File upload
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submission — stores the full Case returned by /apply
  const [submitting, setSubmitting] = useState(false);
  const [submittedCase, setSubmittedCase] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Test packages
  const [packages, setPackages] = useState<TestPackage[]>([]);

  // ?preview=CASE_ID → load an existing case for chain-of-thought inspection
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const previewId = searchParams.get("preview");
    if (previewId && !submittedCase) {
      getCase(previewId).then(setSubmittedCase).catch(() => {});
    }
  }, [searchParams]); // eslint-disable-line

  useEffect(() => {
    getTestPackages().then(setPackages).catch(() => {});
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  // True when the user has uploaded their own application_form.json — form fields are bypassed
  const hasAppFormJson = files.some((f) => f.name === "application_form.json");

  // Inline validation — suppressed entirely when application_form.json is uploaded
  const craError  = (!hasAppFormJson && touched.cra)    ? validateCra(craNumber) : null;
  const amtError  = (!hasAppFormJson && touched.amount) ? validateAmount(requestedAmount, 100_000, 10_000_000, "Requested PacifiCan Amount") : null;
  const dateError = (!hasAppFormJson && touched.dates)  ? validateDates(projectStart, projectEnd) : null;
  const nameError = (!hasAppFormJson && touched.name && !applicantName.trim()) ? "Applicant name is required" : null;

  const handleSubmit = async () => {
    // Touch all fields to surface inline validation errors — only when fields are active
    if (!hasAppFormJson) {
      setTouched({ name: true, cra: true, amount: true, dates: true });
    }

    if (!hasAppFormJson) {
      if (!applicantName.trim()) { setError("Applicant name is required."); return; }
      if (validateCra(craNumber))  { setError("Fix the CRA Business Number before submitting."); return; }
      if (validateAmount(requestedAmount, 100_000, 10_000_000, "Requested PacifiCan Amount")) {
        setError("Requested PacifiCan Amount must be between $100,000 and $10,000,000."); return;
      }
      if (validateDates(projectStart, projectEnd)) { setError("Project start date must be before end date."); return; }
    }
    if (files.length === 0) {
      setError("Please upload at least one document before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const fd = new FormData();
    fd.append("applicant_name",     applicantName.trim() || "Unknown Applicant");
    fd.append("cra_business_number", craNumber.replace(/\s|-/g, ""));
    fd.append("incorporation_date", incorporationDate);
    fd.append("province",           province);
    fd.append("pacifican_facility", pacificanFacility);
    fd.append("project_type",       projectType);
    fd.append("org_type",           orgType);
    fd.append("requested_amount",   requestedAmount || "0");
    fd.append("matching_amount",    matchingAmount  || "0");
    fd.append("project_start",      projectStart);
    fd.append("project_end",        projectEnd);
    files.forEach((f) => fd.append("files", f));

    try {
      // /apply returns the full Case — no second getCase() needed
      const fullCase = await submitApplication(fd);
      setSubmittedCase(fullCase);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Submission failed. Please try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedCase) {
    const isPreview = !!searchParams.get("preview");
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Result summary card */}
        <div className="card">
          <div className="card-header" style={{ background: "#F0FDF4", color: "#15803D", fontSize: 15 }}>
            {isPreview ? "🔍 Application Trace Preview" : "✓ Application Submitted Successfully"}
          </div>
          <div className="card-body">
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div className="text-muted text-sm" style={{ marginBottom: 4 }}>Application ID</div>
                <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "var(--primary)", letterSpacing: 1 }}>
                  {submittedCase.case_id}
                </div>
                {!isPreview && (
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                    Keep this ID for records and any follow-up correspondence.
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted text-sm" style={{ marginBottom: 6 }}>Assessment</div>
                <BasketBadge basket={submittedCase.basket} />
              </div>
            </div>

            {submittedCase.missing_count > 0 && (
              <div className="alert alert-warning" style={{ marginTop: 16, marginBottom: 0 }}>
                <span>⚠</span>
                <span>
                  <strong>{submittedCase.missing_count} document(s)</strong> could not be matched.
                  {!isPreview && " You will receive an email listing the outstanding items."}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Chain of thought — data comes directly from /apply response, no second request */}
        <div className="card">
          <div className="card-body">
            <ChainOfThought c={submittedCase} />
          </div>
        </div>

        <div style={{ marginBottom: 40, marginTop: 8 }}>
          <button
            className="btn-secondary"
            onClick={() => {
              setSubmittedCase(null); setFiles([]);
              setApplicantName(""); setCraNumber(""); setIncorporationDate("");
              setRequestedAmount(""); setMatchingAmount(""); setProjectStart(""); setProjectEnd("");
              setTouched({});
            }}
          >
            ← Submit Another Application
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          Submit Your RDII Application
        </h1>
        <p className="text-muted">
          Regional Defence Investment Initiative — PacifiCan grant application intake portal.
          Complete the form below and upload all required documents.
        </p>
      </div>

      {/* Required documents list */}
      <div className="card">
        <div className="card-header">📋 Required Documents</div>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            {REQUIRED_DOCS.map((doc) => (
              <div key={doc.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--primary)", fontWeight: 700, fontSize: 12, minWidth: 52 }}>
                  {doc.id}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.label}</div>
                  <div className="text-xs text-muted">{doc.hint} · {doc.ext}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted" style={{ marginTop: 12 }}>
            <strong>Note:</strong> The Application Form (DOC-01) is generated automatically from the fields below.
            If you are uploading a full test package that includes <code>application_form.json</code>, the form fields will be ignored.
          </p>
        </div>
      </div>

      {/* Applicant information */}
      <div className="card">
        <div className="card-header">📝 Applicant Information</div>
        <div className="card-body">
          {hasAppFormJson && (
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <span>ℹ</span>
              <span>
                <code>application_form.json</code> detected — form fields are ignored and the uploaded JSON will be used directly.
              </span>
            </div>
          )}

          {/* Row 1: Name + CRA */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Legal / Registered Company Name *</label>
              <input
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                onBlur={() => touch("name")}
                placeholder="e.g. Cascadia Defence Systems Inc."
                disabled={hasAppFormJson}
                style={{ borderColor: nameError ? "#DC2626" : undefined }}
              />
              {nameError && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 3 }}>⚠ {nameError}</div>}
            </div>
            <div>
              <label>CRA Business Number (9 digits)</label>
              <input
                value={craNumber}
                onChange={(e) => setCraNumber(e.target.value)}
                onBlur={() => touch("cra")}
                placeholder="e.g. 123456789"
                disabled={hasAppFormJson}
                style={{ borderColor: craError ? "#DC2626" : craNumber && !craError ? "#059669" : undefined }}
              />
              {craError
                ? <div style={{ color: "#DC2626", fontSize: 11, marginTop: 3 }}>⚠ {craError}</div>
                : craNumber && !validateCra(craNumber)
                ? <div style={{ color: "#059669", fontSize: 11, marginTop: 3 }}>✓ Valid 9-digit CRA BN</div>
                : null}
            </div>
          </div>

          {/* Row 2: Incorporation date + Organisation type */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Date Established in Canada</label>
              <input
                type="date"
                value={incorporationDate}
                onChange={(e) => setIncorporationDate(e.target.value)}
                disabled={hasAppFormJson}
              />
              <div className="text-xs text-muted" style={{ marginTop: 3 }}>Used for R-012 (≥ 2 years operating history)</div>
            </div>
            <div>
              <label>Organisation Type</label>
              <select value={orgType} onChange={(e) => setOrgType(e.target.value)} disabled={hasAppFormJson}>
                {ORG_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-xs text-muted" style={{ marginTop: 3 }}>Used for ER-01 (eligible recipient type)</div>
            </div>
          </div>

          {/* Row 3: Province + BC facility */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Province / Territory of Operations</label>
              <select value={province} onChange={(e) => setProvince(e.target.value)} disabled={hasAppFormJson}>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label>BC Operating Facility? (R-011)</label>
              <select value={pacificanFacility} onChange={(e) => setPacificanFacility(e.target.value)} disabled={hasAppFormJson}>
                <option value="true">Yes — we operate from a BC facility</option>
                <option value="false">No — no BC operating presence</option>
              </select>
              {pacificanFacility === "false" && (
                <div style={{ color: "#D97706", fontSize: 11, marginTop: 3 }}>⚠ R-011 will flag this for officer review</div>
              )}
            </div>
          </div>

          {/* Row 4: Project type */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Project Type</label>
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)} disabled={hasAppFormJson}>
                <option value="non_tech">Non-Technology / General RDII</option>
                <option value="tech_commercialization">Technology Commercialization</option>
              </select>
              {projectType === "tech_commercialization" && (
                <div style={{ color: "#2563EB", fontSize: 11, marginTop: 3 }}>
                  ℹ Tech Commercialization requires DOC-08 (Technology Questionnaire) — R-007 &amp; R-008 will apply
                </div>
              )}
            </div>
          </div>

          {/* Row 5: Funding amounts */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Requested PacifiCan Amount ($) *</label>
              <input
                type="number"
                value={requestedAmount}
                onChange={(e) => setRequestedAmount(e.target.value)}
                onBlur={() => touch("amount")}
                placeholder="Min $100,000 — Max $10,000,000"
                min={0}
                disabled={hasAppFormJson}
                style={{ borderColor: amtError ? "#DC2626" : requestedAmount && !amtError ? "#059669" : undefined }}
              />
              {amtError
                ? <div style={{ color: "#DC2626", fontSize: 11, marginTop: 3 }}>⚠ {amtError} (R-006)</div>
                : requestedAmount && !validateAmount(requestedAmount, 100_000, 10_000_000, "")
                ? <div style={{ color: "#059669", fontSize: 11, marginTop: 3 }}>✓ Within eligible range $100K–$10M</div>
                : null}
            </div>
            <div>
              <label>Matching / Non-PacifiCan Funding ($)</label>
              <input
                type="number"
                value={matchingAmount}
                onChange={(e) => setMatchingAmount(e.target.value)}
                placeholder="e.g. 250000"
                min={0}
                disabled={hasAppFormJson}
                style={{ borderColor: matchingWarn ? "#D97706" : undefined }}
              />
              {matchingWarn && <div style={{ color: "#D97706", fontSize: 11, marginTop: 3 }}>⚠ {matchingWarn}</div>}
              <div className="text-xs text-muted" style={{ marginTop: 3 }}>Used for R-005 (PacifiCan share ≤ 75%)</div>
            </div>
          </div>

          {/* Row 6: Project dates */}
          <div className="grid-2">
            <div>
              <label>Project Start Date</label>
              <input
                type="date"
                value={projectStart}
                onChange={(e) => setProjectStart(e.target.value)}
                onBlur={() => touch("dates")}
                disabled={hasAppFormJson}
                style={{ borderColor: dateError ? "#DC2626" : undefined }}
              />
            </div>
            <div>
              <label>Project End Date</label>
              <input
                type="date"
                value={projectEnd}
                onChange={(e) => setProjectEnd(e.target.value)}
                onBlur={() => touch("dates")}
                disabled={hasAppFormJson}
                style={{ borderColor: dateError ? "#DC2626" : undefined }}
              />
              {dateError && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 3 }}>⚠ {dateError}</div>}
              <div className="text-xs text-muted" style={{ marginTop: 3 }}>R-004 checks: Apr 1, 2026 – Mar 31, 2028</div>
            </div>
          </div>
        </div>
      </div>

      {/* File upload */}
      <div className="card">
        <div className="card-header">
          📁 Upload Documents
          {files.length > 0 && (
            <span className="chip chip-ok" style={{ marginLeft: 8 }}>
              {files.length} file{files.length !== 1 ? "s" : ""} selected
            </span>
          )}
        </div>
        <div className="card-body">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--primary)" : "var(--border)"}`,
              borderRadius: "var(--radius)",
              background: dragging ? "var(--primary-light)" : "var(--bg)",
              padding: "32px 24px",
              textAlign: "center",
              cursor: "pointer",
              transition: "all 0.15s",
              marginBottom: files.length > 0 ? 16 : 0,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Drag &amp; drop files here, or click to browse
            </div>
            <div className="text-sm text-muted">
              Accepted: PDF, XLSX, JSON · You can select multiple files at once
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.json"
              style={{ display: "none" }}
              onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {files.map((f) => (
                <div
                  key={f.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "var(--bg)",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontSize: 18 }}>
                    {f.name.endsWith(".pdf") ? "📄" : f.name.endsWith(".xlsx") ? "📊" : "📋"}
                  </span>
                  <span style={{ fontWeight: 500, flex: 1 }}>{f.name}</span>
                  <span className="text-xs text-muted">{fmt(f.size)}</span>
                  <button
                    className="btn-secondary"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    onClick={() => removeFile(f.name)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sample test files */}
      <div className="card">
        <div className="card-header">🧪 Sample Test Packages</div>
        <div className="card-body">
          <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
            Download a complete test package to try the submission flow. Each ZIP contains all required documents for that scenario.
            Upload the contents and submit to see how the system responds.
          </p>
          {packages.length === 0 ? (
            <div className="text-sm text-muted">Loading packages…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {packages.map((pkg) => (
                <a
                  key={pkg.name}
                  href={testPackageDownloadUrl(pkg.name)}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      padding: "12px 14px",
                      background: "#fff",
                      cursor: "pointer",
                      transition: "box-shadow 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)")}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--primary)" }}>
                        {pkg.name.split("-").slice(0, 2).join("-")}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--primary)" }}>⬇ ZIP</span>
                    </div>
                    <div className="text-xs text-muted">{pkg.description}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error and submit */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>⚠</span> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 40 }}>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={submitting}
          style={{ padding: "10px 28px", fontSize: 15 }}
        >
          {submitting ? "Submitting…" : "Submit Application →"}
        </button>
        <span className="text-sm text-muted">
          You will receive an Application ID immediately upon submission.
        </span>
      </div>
    </div>
  );
}
