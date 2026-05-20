import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTestPackages,
  submitApplication,
  testPackageDownloadUrl,
} from "../api";
import type { SubmitResult, TestPackage } from "../api";

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

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BasketBadge({ basket }: { basket: SubmitResult["basket"] }) {
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
  const [pacificanFacility, setPacificanFacility] = useState(true);
  const [projectType, setProjectType] = useState("non_tech");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [marketingAmount, setMarketingAmount] = useState("");
  const [projectStart, setProjectStart] = useState("");
  const [projectEnd, setProjectEnd] = useState("");

  // File upload
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Test packages
  const [packages, setPackages] = useState<TestPackage[]>([]);

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

  const hasAppFormJson = files.some((f) => f.name === "application_form.json");

  const handleSubmit = async () => {
    if (!applicantName.trim() && !hasAppFormJson) {
      setError("Applicant name is required (or upload an application_form.json).");
      return;
    }
    if (files.length === 0) {
      setError("Please upload at least one document before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const fd = new FormData();
    fd.append("applicant_name", applicantName || "Unknown Applicant");
    fd.append("cra_business_number", craNumber);
    fd.append("incorporation_date", incorporationDate);
    fd.append("province", province);
    fd.append("pacifican_facility", String(pacificanFacility));
    fd.append("project_type", projectType);
    fd.append("requested_amount", requestedAmount || "0");
    fd.append("marketing_amount", marketingAmount || "0");
    fd.append("project_start", projectStart);
    fd.append("project_end", projectEnd);
    files.forEach((f) => fd.append("files", f));

    try {
      const res = await submitApplication(fd);
      setResult(res);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Submission failed. Please try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="card">
          <div className="card-header" style={{ background: "#F0FDF4", color: "#15803D" }}>
            ✓ Application Submitted Successfully
          </div>
          <div className="card-body">
            <div style={{ marginBottom: 24 }}>
              <div className="text-muted text-sm" style={{ marginBottom: 4 }}>Your Application ID</div>
              <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "var(--primary)", letterSpacing: 1 }}>
                {result.case_id}
              </div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                Please keep this ID for your records and any follow-up correspondence.
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <span className="text-muted text-sm" style={{ marginRight: 8 }}>Initial Assessment:</span>
              <BasketBadge basket={result.basket} />
            </div>

            <div className="alert alert-info" style={{ marginBottom: 20 }}>
              {result.message}
            </div>

            {result.missing_count > 0 && (
              <div className="alert alert-warning">
                <span>⚠</span>
                <span>
                  <strong>{result.missing_count} document(s)</strong> could not be matched in your submission.
                  You will receive an email listing the missing items.
                </span>
              </div>
            )}

            <button
              className="btn-secondary"
              onClick={() => {
                setResult(null);
                setFiles([]);
                setApplicantName("");
                setCraNumber("");
              }}
            >
              Submit Another Application
            </button>
          </div>
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
                <code>application_form.json</code> detected in your upload — these fields will be ignored and
                the uploaded form data will be used instead.
              </span>
            </div>
          )}

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Legal / Company Name *</label>
              <input
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                placeholder="e.g. Cascadia Defence Systems Inc."
                disabled={hasAppFormJson}
              />
            </div>
            <div>
              <label>CRA Business Number</label>
              <input
                value={craNumber}
                onChange={(e) => setCraNumber(e.target.value)}
                placeholder="9-digit BN, e.g. 123456789"
                disabled={hasAppFormJson}
              />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Incorporation Date</label>
              <input
                type="date"
                value={incorporationDate}
                onChange={(e) => setIncorporationDate(e.target.value)}
                disabled={hasAppFormJson}
              />
            </div>
            <div>
              <label>Province / Territory</label>
              <select value={province} onChange={(e) => setProvince(e.target.value)} disabled={hasAppFormJson}>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Project Type</label>
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)} disabled={hasAppFormJson}>
                <option value="non_tech">Non-Technology / General</option>
                <option value="tech_commercialization">Technology Commercialization</option>
              </select>
            </div>
            <div>
              <label>PacifiCan-Eligible BC Facility?</label>
              <select
                value={String(pacificanFacility)}
                onChange={(e) => setPacificanFacility(e.target.value === "true")}
                disabled={hasAppFormJson}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label>Requested PacifiCan Amount ($)</label>
              <input
                type="number"
                value={requestedAmount}
                onChange={(e) => setRequestedAmount(e.target.value)}
                placeholder="e.g. 500000"
                min={0}
                disabled={hasAppFormJson}
              />
            </div>
            <div>
              <label>Other / Non-PacifiCan Funding ($)</label>
              <input
                type="number"
                value={marketingAmount}
                onChange={(e) => setMarketingAmount(e.target.value)}
                placeholder="e.g. 250000"
                min={0}
                disabled={hasAppFormJson}
              />
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label>Project Start Date</label>
              <input
                type="date"
                value={projectStart}
                onChange={(e) => setProjectStart(e.target.value)}
                disabled={hasAppFormJson}
              />
            </div>
            <div>
              <label>Project End Date</label>
              <input
                type="date"
                value={projectEnd}
                onChange={(e) => setProjectEnd(e.target.value)}
                disabled={hasAppFormJson}
              />
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
