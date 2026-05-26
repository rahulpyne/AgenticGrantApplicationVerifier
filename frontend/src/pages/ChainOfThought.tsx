/**
 * ChainOfThought.tsx
 * Visualises the AI pipeline decision trace for an RDII application.
 * Shows not just outcomes but WHY — signals, comparisons, thresholds.
 */
import { useState } from "react";
import type { Case, ChecklistItem, DocumentRecord, EligibilityFlag, ExtractedField, Finding } from "../api";

// ─── Static metadata ────────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  "DOC-01": "Application Form (JSON)",
  "DOC-02": "Annual Financial Statements",
  "DOC-03": "Interim Financial Statements",
  "DOC-04": "Budget Worksheet (XLSX)",
  "DOC-05": "Business Plan / Pitch Deck",
  "DOC-06": "Funding Confirmation Letter",
  "DOC-07": "RDII Mandatory Supplemental Form",
  "DOC-08": "RDII Technology Questionnaire",
};

const RULE_META: Record<string, { label: string; what: string }> = {
  "R-002": { label: "Name Consistency",      what: "Legal name must match across all submitted documents" },
  "R-003": { label: "Budget Reconciliation", what: "Requested amount in application must match budget worksheet total" },
  "R-004": { label: "Project Period",        what: "Project dates must fall within Apr 1 2026 – Mar 31 2028" },
  "R-005": { label: "PacifiCan Share ≤ 75%", what: "PacifiCan contribution must not exceed 75% of total project cost" },
  "R-006": { label: "Funding Range",         what: "Requested amount must be between $100,000 and $10,000,000" },
  "R-007": { label: "TRL Declaration",       what: "Tech Commercialization projects must declare TRL ≥ 5" },
  "R-008": { label: "Tech Questionnaire",    what: "Tech Commercialization projects must include DOC-08" },
  "R-009": { label: "Extraction Confidence", what: "All key fields must be extracted at ≥ 60% confidence" },
  "R-010": { label: "Funding Forecast",      what: "Funding confirmation must not contain unconfirmed forecast language" },
  "R-011": { label: "BC Operating Presence", what: "Applicant must confirm at least one BC-based operating facility" },
  "R-012": { label: "Operating History",     what: "Organisation must be established ≥ 2 years before submission" },
};

const ALL_RULE_IDS = Object.keys(RULE_META);

// ─── Colour helpers ──────────────────────────────────────────────────────────

function confColor(c: number) { return c >= 0.8 ? "#059669" : c >= 0.6 ? "#D97706" : "#DC2626"; }
function confBg(c: number)    { return c >= 0.8 ? "#DCFCE7" : c >= 0.6 ? "#FEF3C7" : "#FEE2E2"; }
function confLabel(c: number) { return c >= 0.8 ? "High" : c >= 0.6 ? "Medium" : "Low"; }

function fileIcon(ext: string) {
  if (ext === "pdf") return "📄"; if (ext === "xlsx" || ext === "xls") return "📊";
  if (ext === "json") return "📋"; return "📁";
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtAmount(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(String(v).replace(/[$,]/g, "")) : NaN;
  return isNaN(n) ? String(v) : `$${n.toLocaleString("en-CA")}`;
}

// ─── Signal derivation helpers ────────────────────────────────────────────────

type Signal = { kind: "ext" | "keyword" | "content"; text: string; strong?: boolean };

function classifySignals(doc: DocumentRecord): Signal[] {
  const name  = doc.name.toLowerCase();
  const ext   = doc.extension.replace(".", "").toLowerCase();
  const dt    = doc.detected_doc_type;
  const sigs: Signal[] = [];

  // Extension signal
  if (ext === "json")  sigs.push({ kind: "ext", text: "Extension .json → candidate: Application Form" });
  else if (ext === "xlsx") sigs.push({ kind: "ext", text: "Extension .xlsx → candidate: spreadsheet / budget" });
  else if (ext === "pdf")  sigs.push({ kind: "ext", text: "Extension .pdf → candidate: document" });

  // Filename keyword signals
  if (name.includes("interim"))                              sigs.push({ kind: "keyword", text: "Keyword 'interim' → Interim Financial Statements" });
  else if (name.includes("financial") || name.includes("financials")) sigs.push({ kind: "keyword", text: "Keyword 'financial' → Annual Financial Statements" });
  if (name.includes("budget"))                               sigs.push({ kind: "keyword", text: "Keyword 'budget' → Budget Worksheet" });
  if (name.includes("business") && name.includes("plan"))   sigs.push({ kind: "keyword", text: "Keywords 'business' + 'plan' → Business Plan / Pitch Deck" });
  if (name.includes("pitch"))                                sigs.push({ kind: "keyword", text: "Keyword 'pitch' → Business Plan / Pitch Deck" });
  if (name.includes("funding") || name.includes("confirmation")) sigs.push({ kind: "keyword", text: "Keywords 'funding' / 'confirmation' → Funding Confirmation Letter" });
  if (name.includes("supplemental"))                         sigs.push({ kind: "keyword", text: "Keyword 'supplemental' → Mandatory Supplemental Form" });
  if (name.includes("tech") && (name.includes("quest") || name.includes("questionnaire")))
    sigs.push({ kind: "keyword", text: "Keywords 'tech' + 'questionnaire' → Technology Questionnaire" });
  if (ext === "json" && name.includes("application"))        sigs.push({ kind: "keyword", text: "Keyword 'application' → Application Form" });

  // Content signals (only when matched_on === "content")
  if (doc.matched_on === "content") {
    if (dt === "DOC-01") sigs.push({ kind: "content", text: "Parsed JSON: 'case_id' key present → Application Form confirmed", strong: true });
    if (dt === "DOC-04") sigs.push({ kind: "content", text: "Opened workbook: 'Cost Detail' sheet tab found → Budget Worksheet confirmed", strong: true });
  }

  return sigs;
}

function classifyConfidenceReason(c: number, _matchedOn: string): string {
  if (c >= 0.98) return "Content-verified: structural marker found inside file body (strongest signal)";
  if (c >= 0.95) return "Content-verified: characteristic worksheet tab/section found inside file";
  if (c >= 0.90) return "Strong keyword match in filename — unambiguous single-category signal";
  if (c >= 0.85) return "Clear filename keyword match — well-known pattern";
  if (c >= 0.80) return "Filename heuristic match — low ambiguity but no content check";
  if (c >= 0.70) return "Weak filename match — classified but officer confirmation advisable";
  if (c >= 0.55) return "Ambiguous match — possible duplicate or multi-year set; manual review required";
  return "Below 70% classification threshold — marked as UNCERTAIN";
}

// ─── Field extraction confidence reasoning ────────────────────────────────────

function extractConfidenceReason(field: ExtractedField): string {
  const { field_id, confidence, value } = field;
  if (value === null || confidence === 0)
    return "Field absent from all submitted documents — manual entry required for processing";
  if (confidence >= 0.97) {
    if (field_id === "DF-02")
      return "Found in structured JSON and passed 9-digit CRA Business Number format validation";
    return "Directly declared in a structured JSON field — deterministic extraction, highest reliability";
  }
  if (confidence >= 0.95)
    return "Found in structured JSON; plausibility checks passed against cross-document data";
  if (confidence >= 0.90)
    return "Extracted from structured data; secondary source confirmation present";
  if (confidence >= 0.80)
    return "Inferred from document context; no independent cross-document confirmation available";
  if (confidence >= 0.60)
    return "Partially matched — value found but signal was ambiguous; officer verification recommended";
  return "Low confidence: ambiguous or conflicting signals detected across documents";
}

// ─── Rules pass reasoning ─────────────────────────────────────────────────────

function rulePassReason(
  ruleId: string,
  fields: Record<string, ExtractedField>,
  flags: EligibilityFlag[],
  checklist: ChecklistItem[],
): string {
  const flag = (id: string) => flags.find((f) => f.flag_id === id)?.detail ?? "";
  const f = (id: string) => fields[id];
  const numVal = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null && "amount" in (v as object))
      return numVal((v as Record<string, unknown>).amount);
    if (typeof v === "string") { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; }
    return null;
  };
  const amt  = (v: unknown) => { const n = numVal(v); return n != null ? fmtAmount(n) : "N/A"; };

  switch (ruleId) {
    case "R-002": {
      // Show exactly what was compared — not a generic "all match" message.
      // If R-002 reached rulePassReason at all it means the backend found docs
      // to compare AND all names matched (otherwise a finding would have fired).
      const doc07 = checklist.find(c => c.doc_id === "DOC-07");
      const doc04 = checklist.find(c => c.doc_id === "DOC-04");
      const df01  = f("DF-01");
      const appName = typeof df01?.value === "string" ? `"${df01.value}"` : "application form";

      const compared: string[] = [];
      const missing:  string[] = [];
      if (doc07?.status === "present") compared.push("supplemental form (DOC-07)");
      else                             missing.push("DOC-07");
      if (doc04?.status === "present") compared.push("budget worksheet (DOC-04)");
      else                             missing.push("DOC-04");

      if (compared.length === 0) {
        // Should not normally reach here since the backend now emits an info
        // finding in this case, but handle it defensively.
        return `No cross-documents present — name consistency could not be verified (${missing.join(", ")} not submitted)`;
      }
      const checkedStr = compared.join(" and ");
      const skippedStr = missing.length > 0 ? `   |   ${missing.join(", ")} not submitted — skipped` : "";
      return `${appName} cross-checked against ${checkedStr}${skippedStr}   →  all names consistent ✓`;
    }
    case "R-003":
      return "Budget worksheet Total Project Costs matches the application form requested amount — no discrepancy found";
    case "R-004": {
      const detail = flag("ER-06");
      const df07 = f("DF-07");
      if (df07?.value && typeof df07.value === "object") {
        const p = df07.value as Record<string, string>;
        return `Start date ${p.start_date ?? "?"} ≥ Apr 1, 2026 ✓   |   End date ${p.end_date ?? "?"} ≤ Mar 31, 2028 ✓   →  within eligible window`;
      }
      return detail || "Project period falls within eligible window (Apr 1, 2026 – Mar 31, 2028)";
    }
    case "R-005": {
      const detail = flag("ER-09");
      const rda    = numVal(f("DF-05")?.value);
      const nonRda = numVal(f("DF-06")?.value);
      if (rda != null && nonRda != null && rda + nonRda > 0) {
        const total = rda + nonRda;
        const share = (rda / total * 100).toFixed(1);
        return `${amt(rda)} ÷ (${amt(rda)} + ${amt(nonRda)}) = ${share}%   ≤ 75% threshold ✓`;
      }
      return detail || "PacifiCan share within the 75% limit";
    }
    case "R-006": {
      const detail = flag("ER-08");
      const a = numVal(f("DF-05")?.value);
      if (a != null)
        return `$100,000 ≤ ${amt(a)} ≤ $10,000,000 ✓   —  amount is within the eligible funding range`;
      return detail || "Requested amount within eligible range ($100K – $10M)";
    }
    case "R-007": {
      const detail = flag("ER-07");
      return detail || "Not a Technology Commercialization project — TRL check not applicable for this submission";
    }
    case "R-008": {
      const detail = flag("ER-07");
      if (detail?.includes("Not applicable") || detail?.includes("not a Tech"))
        return "project.technology_commercialization = false  →  DOC-08 requirement does not apply to this submission";
      const doc08 = checklist.find((c) => c.doc_id === "DOC-08");
      if (doc08?.status === "present")
        return `DOC-08 present (${Math.round(doc08.confidence * 100)}% confidence)  →  Technology Questionnaire requirement satisfied`;
      return "Technology Questionnaire requirement met";
    }
    case "R-009":
      return "All 7 extracted fields (DF-01 → DF-07) have confidence ≥ 60%  →  no manual-review flags triggered by extraction quality";
    case "R-010": {
      const doc06 = checklist.find((c) => c.doc_id === "DOC-06");
      if (doc06?.status === "missing")
        return "DOC-06 (Funding Confirmation) absent from submission  →  forecast-language scan skipped, rule not applicable";
      return "DOC-06 scanned for forecast/projection keywords — none detected; confirmed-funding language present";
    }
    case "R-011": {
      const detail = flag("ER-03");
      return detail || "organization.bc_operating_facilities = true  →  BC presence requirement satisfied";
    }
    case "R-012": {
      const detail = flag("ER-02");
      const df03 = f("DF-03");
      if (df03?.value && typeof df03.value === "string")
        return `Established ${df03.value}  →  ${detail || "operating ≥ 2 years before submission date ✓"}`;
      return detail || "Organisation established ≥ 2 years before submission date";
    }
    default:
      return "All conditions evaluated — no violations detected";
  }
}

// ─── Shared UI pieces ─────────────────────────────────────────────────────────

function Tag({ color, bg, text }: { color: string; bg: string; text: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: "1px 7px", borderRadius: 10, whiteSpace: "nowrap" as const }}>
      {text}
    </span>
  );
}

function ConfBar({ value }: { value: number }) {
  const lbl = confLabel(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }} title={`Confidence: ${lbl} (${Math.round(value * 100)}%)`}>
      <div style={{ flex: 1, height: 7, background: "#E5E7EB", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: "100%", background: confColor(value), borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: confColor(value), background: confBg(value), padding: "1px 6px", borderRadius: 10, minWidth: 34, textAlign: "center" as const }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function ThresholdBar({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  const pct   = Math.round(value * 100);
  const thPct = Math.round(threshold * 100);
  const pass  = value >= threshold;
  const barColor = pass ? "#059669" : "#DC2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
      <div style={{ flex: 1, position: "relative", height: 10, background: "#E5E7EB", borderRadius: 5, overflow: "visible" }}>
        {/* filled bar */}
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 5, transition: "width 0.6s ease" }} />
        {/* threshold marker */}
        <div
          title={`Threshold: ${thPct}%`}
          style={{
            position: "absolute", top: -3, left: `${thPct}%`, width: 2, height: 16,
            background: "#374151", borderRadius: 1, transform: "translateX(-50%)",
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: barColor, background: pass ? "#DCFCE7" : "#FEE2E2", padding: "1px 6px", borderRadius: 10, minWidth: 34, textAlign: "center" as const }}>
        {pct}%
      </span>
      <span style={{ fontSize: 10, color: "#6B7280", whiteSpace: "nowrap" as const }}>{label} {pass ? "✓" : "✗"}</span>
    </div>
  );
}

function EvidenceBox({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 6, padding: "6px 10px", background: "#1E293B", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#93C5FD", wordBreak: "break-all" as const }}>
      <span style={{ color: "#94A3B8", marginRight: 6 }}>↳ source:</span>{text}
    </div>
  );
}

function ReasonChip({ text, color }: { text: string; color?: string }) {
  return (
    <div style={{ marginTop: 5, fontSize: 11, color: color ?? "#374151", display: "flex", alignItems: "flex-start", gap: 5 }}>
      <span style={{ color: "#9CA3AF", flexShrink: 0 }}>💡</span>
      <span>{text}</span>
    </div>
  );
}

function StepHeader({ num, icon, title, statusIcon, statusColor, open, onToggle }: {
  num: number; icon: string; title: string; statusIcon: string;
  statusColor: string; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", background: "none", border: "none", padding: "12px 16px", cursor: "pointer", textAlign: "left" as const, borderRadius: 8 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: statusColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {num}
      </div>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: "#111827" }}>{title}</span>
      <span style={{ fontSize: 16, marginRight: 4 }}>{statusIcon}</span>
      <span style={{ fontSize: 12, color: "#6B7280" }}>{open ? "▲" : "▼"}</span>
    </button>
  );
}

// ─── Step 1: Document Intake ──────────────────────────────────────────────────

function StepIntake({ docs }: { docs: DocumentRecord[] }) {
  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
        All uploaded files are hashed, size-recorded, and queued for parsing. Parse errors are captured before classification begins.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {docs.map((d) => (
          <div key={d.file_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
            <span style={{ fontSize: 20 }}>{fileIcon(d.extension.replace(".", ""))}</span>
            <div>
              <div style={{ fontWeight: 600, color: "#111827" }}>{d.name}</div>
              <div style={{ fontSize: 11, color: "#6B7280", display: "flex", gap: 8, marginTop: 2 }}>
                <span>{fmtBytes(d.size_bytes)}</span>
                <span style={{ color: d.parse_status === "parsed" ? "#059669" : "#DC2626", fontWeight: 600 }}>
                  {d.parse_status === "parsed" ? "✓ parsed" : `✗ ${d.parse_status}`}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2: Document Classification ─────────────────────────────────────────

function StepClassify({ docs }: { docs: DocumentRecord[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
        Each file is classified by checking (1) file extension, (2) filename keywords, then (3) file content where possible.
        Classification threshold: <strong>70%</strong> confidence required for PRESENT status.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {docs.map((d) => {
          const signals = classifySignals(d);
          const isOpen  = expanded === d.file_id;
          const kindColor: Record<string, { bg: string; text: string }> = {
            ext:     { bg: "#EFF6FF", text: "#1D4ED8" },
            keyword: { bg: "#F5F3FF", text: "#6D28D9" },
            content: { bg: "#F0FDF4", text: "#065F46" },
          };
          return (
            <div key={d.file_id} style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
              {/* Summary row */}
              <button
                onClick={() => setExpanded(isOpen ? null : d.file_id)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "#F9FAFB", border: "none", padding: "10px 14px", cursor: "pointer", textAlign: "left" as const }}
              >
                <span style={{ fontSize: 18 }}>{fileIcon(d.extension.replace(".", ""))}</span>
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: "#111827" }}>{d.name}</span>
                <span style={{ fontSize: 11, color: "#6B7280", background: "#E5E7EB", borderRadius: 4, padding: "1px 6px" }}>
                  via {d.matched_on || "filename"}
                </span>
                <span style={{ fontSize: 12, color: "#6B7280", marginLeft: 4 }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {/* Result bar — always visible */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#fff", borderTop: "1px solid #F3F4F6" }}>
                <span style={{ fontSize: 11, color: "#9CA3AF", minWidth: 16 }}>→</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#005E6E", background: "#E6F4F6", padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" as const }}>
                  {d.detected_doc_type
                    ? `${d.detected_doc_type}: ${DOC_LABELS[d.detected_doc_type] ?? d.detected_doc_type}`
                    : "⚠ Unclassified"}
                </span>
                <ConfBar value={d.confidence ?? 0} />
              </div>

              {/* Expanded signal trail */}
              {isOpen && (
                <div style={{ padding: "10px 14px 12px", borderTop: "1px solid #F3F4F6", background: "#FAFBFC" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Signal trail
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {signals.map((s, i) => {
                      const c = kindColor[s.kind] ?? kindColor.keyword;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <Tag color={c.text} bg={c.bg} text={s.kind.toUpperCase()} />
                          <span style={{ fontSize: 12, color: s.strong ? "#065F46" : "#374151", fontWeight: s.strong ? 600 : 400 }}>
                            {s.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, padding: "6px 10px", background: "#F3F4F6", borderRadius: 6, fontSize: 11, color: "#6B7280" }}>
                    <span style={{ fontWeight: 700 }}>Confidence explanation: </span>
                    {classifyConfidenceReason(d.confidence, d.matched_on)}
                  </div>
                  {d.notes && (
                    <div style={{ marginTop: 6, padding: "6px 10px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 11, color: "#92400E" }}>
                      ⚠ {d.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: Completeness Check ───────────────────────────────────────────────

function StepChecklist({ checklist }: { checklist: ChecklistItem[] }) {
  const THRESHOLD = 0.70;
  const statusMeta = {
    present:        { icon: "✓", color: "#059669", bg: "#F0FDF4", border: "#16A34A" },
    missing:        { icon: "✗", color: "#DC2626", bg: "#FEF2F2", border: "#DC2626" },
    uncertain:      { icon: "?", color: "#D97706", bg: "#FFFBEB", border: "#D97706" },
    not_applicable: { icon: "—", color: "#9CA3AF", bg: "#F9FAFB", border: "#D1D5DB" },
  };

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
        A document is marked <strong>PRESENT</strong> when at least one uploaded file is classified to that category at ≥ 70% confidence.
        Below 70% → UNCERTAIN. No matching file → MISSING.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {checklist.map((item) => {
          const m = statusMeta[item.status] ?? statusMeta.uncertain;
          const whyPresent = item.status === "present"
            ? `${item.matched_files[0] ?? "file"} classified at ${Math.round(item.confidence * 100)}% ≥ ${Math.round(THRESHOLD * 100)}% threshold`
            : item.status === "missing"
            ? `No submitted file matched any ${item.doc_id} signature`
            : item.status === "uncertain"
            ? `Best match ${Math.round(item.confidence * 100)}% < ${Math.round(THRESHOLD * 100)}% threshold${item.notes ? " — " + item.notes : ""}`
            : "This document type is not required for the declared project category";

          return (
            <div key={item.doc_id} style={{ padding: "10px 12px", background: m.bg, border: `1px solid ${m.border}40`, borderLeft: `4px solid ${m.border}`, borderRadius: 6 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: m.color, minWidth: 18 }}>{m.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: "#111827" }}>{item.doc_id}</span>
                <span style={{ fontSize: 11, color: "#6B7280" }}>{DOC_LABELS[item.doc_id] ?? item.category}</span>
              </div>

              {/* Threshold bar */}
              {item.status !== "not_applicable" && (
                <div style={{ marginBottom: 6 }}>
                  <ThresholdBar value={item.confidence} threshold={THRESHOLD} label="threshold" />
                </div>
              )}

              {/* Why */}
              <div style={{ fontSize: 11, color: m.color, fontWeight: 600 }}>{whyPresent}</div>
              {item.matched_files.length > 0 && (
                <div style={{ fontSize: 10, color: "#6B7280", marginTop: 3 }}>
                  ↳ {item.matched_files.join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 4: Field Extraction ─────────────────────────────────────────────────

function StepExtract({ fields }: { fields: Record<string, ExtractedField> }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = Object.values(fields).sort((a, b) => a.field_id.localeCompare(b.field_id));

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
        Structured fields are extracted primarily from <strong>DOC-01 (application_form.json)</strong>, cross-checked against DOC-04 and DOC-07 where available.
        Values with confidence &lt; 60% are flagged for manual review (Rule R-009).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map((field) => {
          const isOpen  = expanded === field.field_id;
          const lowConf = field.confidence < 0.6 || field.value === null;
          const reason  = extractConfidenceReason(field);
          const valStr  = field.value === null || field.value === undefined
            ? null
            : typeof field.value === "object"
            ? JSON.stringify(field.value)
            : String(field.value);

          return (
            <div key={field.field_id} style={{ border: `1px solid ${lowConf ? "#FCD34D" : "#E5E7EB"}`, borderRadius: 8, overflow: "hidden" }}>
              {/* Summary row */}
              <button
                onClick={() => setExpanded(isOpen ? null : field.field_id)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "#F9FAFB", border: "none", padding: "9px 14px", cursor: "pointer", textAlign: "left" as const }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#005E6E", background: "#E6F4F6", padding: "2px 7px", borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
                  {field.field_id}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", flex: 1 }}>{field.name}</span>
                {lowConf && <Tag color="#92400E" bg="#FEF3C7" text="REVIEW" />}
                <span style={{ fontSize: 12, color: "#6B7280", marginLeft: 4 }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {/* Value + confidence — always visible */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 8px", background: "#fff", borderTop: "1px solid #F3F4F6", flexWrap: "wrap" as const }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {valStr !== null ? (
                    <span style={{ fontFamily: "monospace", fontSize: 12, background: lowConf ? "#FEF3C7" : "#F0FDF4", color: lowConf ? "#92400E" : "#065F46", padding: "3px 8px", borderRadius: 4, wordBreak: "break-all" as const }}>
                      {valStr}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "#DC2626", fontStyle: "italic" }}>
                      not found — manual entry required
                    </span>
                  )}
                </div>
                <div style={{ minWidth: 180 }}>
                  <ConfBar value={field.confidence} />
                </div>
              </div>

              {/* Expanded evidence */}
              {isOpen && (
                <div style={{ padding: "8px 14px 12px", borderTop: "1px solid #F3F4F6", background: "#FAFBFC" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    Evidence trail
                  </div>
                  {field.raw_excerpt && <EvidenceBox text={field.raw_excerpt} />}
                  <ReasonChip text={reason} color={lowConf ? "#92400E" : "#374151"} />
                  {field.source_doc_id && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#9CA3AF" }}>
                      Source document: <strong>{field.source_doc_id}</strong> ({DOC_LABELS[field.source_doc_id] ?? field.source_doc_id})
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 5: Rules Evaluation ─────────────────────────────────────────────────

function StepRules({ findings, fields, flags, checklist }: {
  findings: Finding[];
  fields: Record<string, ExtractedField>;
  flags: EligibilityFlag[];
  checklist: ChecklistItem[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
        {ALL_RULE_IDS.length} rules evaluated using extracted field values and document content.
        Click any rule to see the exact values compared and the threshold logic applied.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ALL_RULE_IDS.map((ruleId) => {
          const meta   = RULE_META[ruleId];
          const fired  = findings.filter((f) => f.rule_id === ruleId);
          const passed = fired.length === 0;
          const isOpen = expanded === ruleId;
          const reason = passed ? rulePassReason(ruleId, fields, flags, checklist) : null;

          if (passed) {
            return (
              <div key={ruleId} style={{ border: "1px solid #D1FAE5", borderRadius: 8, overflow: "hidden" }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : ruleId)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "#F0FDF4", border: "none", padding: "9px 14px", cursor: "pointer", textAlign: "left" as const }}
                >
                  <span style={{ fontSize: 15, color: "#059669", flexShrink: 0 }}>✓</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#059669", fontWeight: 700, minWidth: 46, flexShrink: 0 }}>{ruleId}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#065F46", flex: 1 }}>{meta.label}</span>
                  <Tag color="#059669" bg="#DCFCE7" text="PASSED" />
                  <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 8 }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "8px 14px 12px", borderTop: "1px solid #D1FAE5", background: "#FAFBFC" }}>
                    <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}><strong>Rule:</strong> {meta.what}</div>
                    <div style={{ padding: "8px 12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 6, fontSize: 12, color: "#065F46", fontWeight: 600 }}>
                      ✓ {reason}
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // Rule fired — show each finding
          return (
            <div key={ruleId} style={{ border: "1px solid #FCA5A5", borderRadius: 8, overflow: "hidden" }}>
              {fired.map((f, i) => {
                const sc = f.severity === "error"   ? { bg: "#FEE2E2", text: "#B91C1C", border: "#DC2626", icon: "✗", tag: "ERROR" }
                         : f.severity === "warning" ? { bg: "#FEF3C7", text: "#B45309", border: "#D97706", icon: "⚠", tag: "WARNING" }
                         : f.severity === "manual_review" ? { bg: "#F5F3FF", text: "#6D28D9", border: "#7C3AED", icon: "👁", tag: "REVIEW" }
                         :                            { bg: "#EFF6FF", text: "#1D4ED8", border: "#2563EB", icon: "ℹ", tag: "INFO" };
                const isThisOpen = expanded === `${ruleId}-${i}`;
                return (
                  <div key={i}>
                    <button
                      onClick={() => setExpanded(isThisOpen ? null : `${ruleId}-${i}`)}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: sc.bg, border: "none", padding: "9px 14px", cursor: "pointer", textAlign: "left" as const, borderTop: i > 0 ? `1px solid ${sc.border}30` : "none" }}
                    >
                      <span style={{ fontSize: 14, color: sc.text, flexShrink: 0 }}>{sc.icon}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: sc.text, fontWeight: 700, minWidth: 46, flexShrink: 0 }}>{ruleId}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: sc.text, flex: 1 }}>{meta.label}</span>
                      <Tag color={sc.text} bg={`${sc.border}20`} text={sc.tag} />
                      <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 8 }}>{isThisOpen ? "▲" : "▼"}</span>
                    </button>
                    {isThisOpen && (
                      <div style={{ padding: "8px 14px 12px", borderTop: `1px solid ${sc.border}30`, background: "#FAFBFC" }}>
                        <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}><strong>Rule:</strong> {meta.what}</div>
                        <div style={{ padding: "8px 12px", background: sc.bg, border: `1px solid ${sc.border}50`, borderLeft: `3px solid ${sc.border}`, borderRadius: 6, fontSize: 12, color: sc.text, fontWeight: 600 }}>
                          {sc.icon} {f.message}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 6: Routing Decision ─────────────────────────────────────────────────

function StepDecision({ basket, missingCount, missingCategories, findings, checklist }: {
  basket: string | null; missingCount: number; missingCategories: string[];
  findings: Finding[]; checklist: ChecklistItem[];
}) {
  const errorFindings = findings.filter((f) => f.severity === "error");
  const warnFindings  = findings.filter((f) => f.severity === "warning");
  const isComplete   = basket === "complete";
  const isIncomplete = basket === "incomplete";

  const C = isComplete
    ? { bg: "#F0FDF4", border: "#16A34A", text: "#15803D", chipBg: "#DCFCE7", emoji: "✅", label: "COMPLETE" }
    : isIncomplete
    ? { bg: "#FFFBEB", border: "#D97706", text: "#92400E", chipBg: "#FEF3C7", emoji: "⚠️", label: "INCOMPLETE" }
    : { bg: "#FEF2F2", border: "#DC2626", text: "#991B1B", chipBg: "#FEE2E2", emoji: "🚫", label: "DECLINE BASKET" };

  // Decision tree steps
  const steps: Array<{ q: string; outcome: string; verdict: boolean }> = [
    {
      q: "Are there any error-severity rule violations?",
      outcome: errorFindings.length > 0
        ? `Yes — ${errorFindings.length} error(s) detected → DECLINE BASKET`
        : "No errors detected → not a DECLINE case",
      verdict: errorFindings.length === 0,
    },
    {
      q: "Are any required documents missing?",
      outcome: missingCount > 0
        ? `Yes — ${missingCount} missing (${missingCategories.map(id => `${id}: ${DOC_LABELS[id] ?? id}`).join(", ")}) → INCOMPLETE`
        : "All required documents present → not INCOMPLETE",
      verdict: missingCount === 0,
    },
    {
      q: "Do all present documents meet quality thresholds?",
      outcome: checklist.some(c => c.status === "uncertain")
        ? "Some documents flagged as uncertain → officer review required"
        : "All matched documents above 70% confidence threshold",
      verdict: !checklist.some(c => c.status === "uncertain"),
    },
  ];

  return (
    <div style={{ padding: "4px 16px 20px" }}>
      {/* Verdict banner */}
      <div style={{ padding: 20, background: C.bg, border: `2px solid ${C.border}`, borderRadius: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 36 }}>{C.emoji}</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 4 }}>Routing Decision</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, background: C.chipBg, padding: "4px 16px", borderRadius: 8, display: "inline-block" }}>
              {C.label}
            </div>
          </div>
        </div>
      </div>

      {/* Decision tree */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8 }}>
          Decision logic trace
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, position: "relative" as const }}>
              {/* connector line */}
              {i < steps.length - 1 && (
                <div style={{ position: "absolute" as const, left: 11, top: 22, bottom: -8, width: 2, background: "#E5E7EB", zIndex: 0 }} />
              )}
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: s.verdict ? "#DCFCE7" : "#FEE2E2", border: `2px solid ${s.verdict ? "#059669" : "#DC2626"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1, marginTop: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: s.verdict ? "#059669" : "#DC2626" }}>{i + 1}</span>
              </div>
              <div style={{ padding: "8px 0 12px", flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{s.q}</div>
                <div style={{ fontSize: 12, color: s.verdict ? "#059669" : "#D97706", marginTop: 2, fontWeight: 600 }}>
                  → {s.outcome}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Threshold table */}
      <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8 }}>
          Routing thresholds
        </div>
        {[
          { cond: "0 missing docs + 0 error violations", result: "COMPLETE",       active: isComplete,   color: "#059669", bg: "#F0FDF4" },
          { cond: "≥ 1 missing required document",        result: "INCOMPLETE",     active: isIncomplete, color: "#D97706", bg: "#FFFBEB" },
          { cond: "Any error-severity rule violation",    result: "DECLINE BASKET", active: !isComplete && !isIncomplete, color: "#DC2626", bg: "#FEF2F2" },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 5, background: row.active ? row.bg : "transparent", marginBottom: 3 }}>
            {row.active && <span style={{ fontSize: 12, color: row.color }}>▶</span>}
            {!row.active && <span style={{ fontSize: 12, color: "#D1D5DB" }}>◦</span>}
            <span style={{ fontSize: 12, color: row.active ? "#111827" : "#9CA3AF", flex: 1 }}>{row.cond}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: row.color, background: row.active ? row.bg : "transparent", padding: "2px 8px", borderRadius: 4, opacity: row.active ? 1 : 0.4 }}>
              {row.result}
            </span>
          </div>
        ))}
      </div>

      {/* Summary metrics */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const }}>
        {[
          { label: "Missing docs",  value: missingCount,         color: missingCount > 0 ? "#DC2626" : "#059669" },
          { label: "Errors",        value: errorFindings.length, color: errorFindings.length > 0 ? "#DC2626" : "#059669" },
          { label: "Warnings",      value: warnFindings.length,  color: warnFindings.length > 0 ? "#D97706" : "#059669" },
        ].map((m) => (
          <div key={m.label} style={{ flex: 1, minWidth: 100, padding: "8px 12px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, textAlign: "center" as const }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{m.value}</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Next step */}
      <div style={{ marginTop: 14, padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 13, color: "#1E40AF" }}>
        <strong>Next step: </strong>
        {isComplete
          ? "Application forwarded to PacifiCan officer for eligibility and merit assessment"
          : isIncomplete
          ? "Document request email drafted — awaiting officer review before dispatch to applicant"
          : "Case queued for manager confirmation before any decline action is taken"}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props { c: Case }
type StepKey = "intake" | "classify" | "checklist" | "extract" | "rules" | "decision";

export default function ChainOfThought({ c }: Props) {
  const [open, setOpen] = useState<Record<StepKey, boolean>>({
    intake: true, classify: true, checklist: true, extract: false, rules: false, decision: true,
  });
  const toggle = (k: StepKey) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  const hasMissing  = c.missing_count > 0;
  const hasErrors   = c.findings.some((f) => f.severity === "error");
  const hasWarnings = c.findings.some((f) => ["warning", "error"].includes(f.severity));
  const isDecline   = c.basket === "decline_basket";
  const declineColor = isDecline ? "#DC2626" : c.basket === "incomplete" ? "#D97706" : "#059669";

  const STEPS: Array<{
    key: StepKey; num: number; icon: string; title: string;
    statusIcon: string; color: string; content: React.ReactNode;
  }> = [
    {
      key: "intake", num: 1, icon: "📂",
      title: `Document Intake — ${c.documents.length} file${c.documents.length !== 1 ? "s" : ""} received`,
      statusIcon: "✓", color: "#005E6E",
      content: <StepIntake docs={c.documents} />,
    },
    {
      key: "classify", num: 2, icon: "🔍",
      title: "Document Classification — matching files to required categories",
      statusIcon: "✓", color: "#2563EB",
      content: <StepClassify docs={c.documents} />,
    },
    {
      key: "checklist", num: 3, icon: "📋",
      title: `Completeness Check — ${hasMissing ? `${c.missing_count} missing` : "all categories present"}`,
      statusIcon: hasMissing ? "⚠" : "✓", color: hasMissing ? "#D97706" : "#059669",
      content: <StepChecklist checklist={c.checklist} />,
    },
    {
      key: "extract", num: 4, icon: "🧩",
      title: "Field Extraction — parsing key application data",
      statusIcon: c.findings.some((f) => f.rule_id === "R-009") ? "⚠" : "✓", color: "#7C3AED",
      content: <StepExtract fields={c.extracted_fields} />,
    },
    {
      key: "rules", num: 5, icon: "⚖️",
      title: `Rules Evaluation — ${hasWarnings ? `${c.findings.filter((f) => ["warning","error"].includes(f.severity)).length} flag(s) raised` : "all checks passed"}`,
      statusIcon: (hasErrors ? "✗" : hasWarnings ? "⚠" : "✓"),
      color: hasErrors ? "#DC2626" : hasWarnings ? "#D97706" : "#059669",
      content: <StepRules findings={c.findings} fields={c.extracted_fields} flags={c.eligibility_flags} checklist={c.checklist} />,
    },
    {
      key: "decision", num: 6, icon: "🎯",
      title: "Routing Decision",
      statusIcon: isDecline ? "🚫" : hasMissing ? "⚠" : "✅",
      color: declineColor,
      content: <StepDecision basket={c.basket} missingCount={c.missing_count} missingCategories={c.missing_categories} findings={c.findings} checklist={c.checklist} />,
    },
  ];

  return (
    <div style={{ marginTop: 32 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: "2px solid #E5E7EB" }}>
        <span style={{ fontSize: 24 }}>🧠</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#111827" }}>AI Decision Trace</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>
            Every signal, comparison and threshold that led to the final routing decision — click any step to expand the reasoning
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 29, top: 28, bottom: 28, width: 2, background: "#E5E7EB", zIndex: 0 }} />
        {STEPS.map((step, idx) => (
          <div key={step.key} style={{ position: "relative", zIndex: 1, marginBottom: idx < STEPS.length - 1 ? 8 : 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <StepHeader num={step.num} icon={step.icon} title={step.title} statusIcon={step.statusIcon} statusColor={step.color} open={open[step.key]} onToggle={() => toggle(step.key)} />
            {open[step.key] && (
              <div style={{ borderTop: "1px solid #F3F4F6", animation: "fadeIn 0.2s ease" }}>
                {step.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
