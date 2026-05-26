/**
 * ChainOfThought.tsx
 * Visualises the AI pipeline decision trace for an RDII application.
 * Rendered at the bottom of the ApplicantPortal success screen.
 */
import { useState } from "react";
import type { Case, ChecklistItem, DocumentRecord, ExtractedField, Finding } from "../api";

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

const RULE_META: Record<string, { label: string; description: string }> = {
  "R-002": { label: "Name Consistency",    description: "Legal name matches across application form, supplemental form, and budget worksheet" },
  "R-003": { label: "Budget Reconciliation", description: "Requested amount in application matches total in budget worksheet" },
  "R-004": { label: "Project Period",      description: "Project dates fall within the eligible window (Apr 1 2026 – Mar 31 2028)" },
  "R-005": { label: "PacifiCan Share",     description: "PacifiCan contribution does not exceed 75% of total project cost" },
  "R-006": { label: "Funding Range",       description: "Requested amount is between $100 K and $10 M" },
  "R-007": { label: "TRL Declaration",     description: "Technology Readiness Level declared for tech-commercialization projects" },
  "R-008": { label: "Tech Questionnaire",  description: "Technology questionnaire present when project type is technology commercialization" },
  "R-009": { label: "Extraction Confidence", description: "All key fields extracted with ≥ 60% confidence; low-confidence fields flagged for manual review" },
  "R-010": { label: "Funding Forecast",    description: "Funding confirmation letter includes a forecast or projected-year figure" },
  "R-011": { label: "BC Operating Presence", description: "Applicant confirms at least one BC-based operating facility" },
  "R-012": { label: "Operating History",   description: "Organisation established for at least 2 years prior to submission" },
};

const ALL_RULE_IDS = Object.keys(RULE_META);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confColor(c: number): string {
  if (c >= 0.8) return "#059669";
  if (c >= 0.6) return "#D97706";
  return "#DC2626";
}

function confBg(c: number): string {
  if (c >= 0.8) return "#DCFCE7";
  if (c >= 0.6) return "#FEF3C7";
  return "#FEE2E2";
}

function confLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.6) return "Medium";
  return "Low";
}

function fileIcon(ext: string): string {
  if (ext === "pdf") return "📄";
  if (ext === "xlsx" || ext === "xls") return "📊";
  if (ext === "json") return "📋";
  return "📁";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function severityColor(s: string) {
  if (s === "error") return { bg: "#FEE2E2", text: "#B91C1C", border: "#DC2626", icon: "✗" };
  if (s === "warning") return { bg: "#FEF3C7", text: "#B45309", border: "#D97706", icon: "⚠" };
  if (s === "manual_review") return { bg: "#F5F3FF", text: "#6D28D9", border: "#7C3AED", icon: "👁" };
  return { bg: "#EFF6FF", text: "#1D4ED8", border: "#2563EB", icon: "ℹ" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const label = confLabel(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }} title={`Confidence: ${label}`}>
      <div style={{ flex: 1, height: 7, background: "#E5E7EB", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            background: confColor(value),
            borderRadius: 4,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: confColor(value),
          background: confBg(value),
          padding: "1px 6px",
          borderRadius: 10,
          minWidth: 36,
          textAlign: "center",
        }}
      >
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function StepHeader({
  num,
  icon,
  title,
  statusIcon,
  statusColor,
  open,
  onToggle,
}: {
  num: number;
  icon: string;
  title: string;
  statusIcon: string;
  statusColor: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        background: "none",
        border: "none",
        padding: "12px 16px",
        cursor: "pointer",
        textAlign: "left",
        borderRadius: 8,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: statusColor,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {num}
      </div>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: "#111827" }}>{title}</span>
      <span style={{ fontSize: 18, marginRight: 4 }}>{statusIcon}</span>
      <span style={{ fontSize: 12, color: "#6B7280" }}>{open ? "▲" : "▼"}</span>
    </button>
  );
}

// ─── Step 1: Document Intake ─────────────────────────────────────────────────

function StepIntake({ docs }: { docs: DocumentRecord[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 16px 16px" }}>
      {docs.map((d) => (
        <div
          key={d.file_id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "#F9FAFB",
            border: "1px solid #E5E7EB",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <span style={{ fontSize: 18 }}>{fileIcon(d.extension)}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{d.name}</div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>
              {fmtBytes(d.size_bytes)} ·{" "}
              <span style={{ color: d.parse_status === "parsed" ? "#059669" : "#DC2626" }}>
                {d.parse_status}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Step 2: Document Classification ─────────────────────────────────────────

function StepClassify({ docs }: { docs: DocumentRecord[] }) {
  return (
    <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      {docs.map((d) => (
        <div
          key={d.file_id}
          style={{
            padding: "10px 14px",
            background: "#F9FAFB",
            border: "1px solid #E5E7EB",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span>{fileIcon(d.extension)}</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</span>
            <span
              style={{
                fontSize: 11,
                color: "#6B7280",
                background: "#E5E7EB",
                borderRadius: 4,
                padding: "1px 6px",
                marginLeft: "auto",
              }}
            >
              matched on: {d.matched_on || "filename"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#374151", minWidth: 16 }}>→</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#005E6E",
                background: "#E6F4F6",
                borderRadius: 4,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {d.detected_doc_type
                ? `${d.detected_doc_type}: ${DOC_LABELS[d.detected_doc_type] ?? d.detected_doc_type}`
                : "Unclassified"}
            </span>
            <ConfBar value={d.confidence ?? 0} />
          </div>
          {d.notes && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#D97706", fontStyle: "italic" }}>
              ⚠ {d.notes}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 3: Completeness Check ───────────────────────────────────────────────

function StepChecklist({ checklist }: { checklist: ChecklistItem[] }) {
  return (
    <div style={{ padding: "4px 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {checklist.map((item) => {
        const present = item.status === "present";
        const na = item.status === "not_applicable";
        const color = present ? "#059669" : na ? "#6B7280" : item.status === "uncertain" ? "#D97706" : "#DC2626";
        const bg = present ? "#F0FDF4" : na ? "#F9FAFB" : item.status === "uncertain" ? "#FFFBEB" : "#FEF2F2";
        const statusIcon = present ? "✓" : na ? "N/A" : item.status === "uncertain" ? "?" : "✗";
        return (
          <div
            key={item.doc_id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              background: bg,
              border: `1px solid ${color}40`,
              borderLeft: `4px solid ${color}`,
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 800, color, minWidth: 20 }}>{statusIcon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#111827" }}>
                {item.doc_id}: {DOC_LABELS[item.doc_id] ?? item.category}
              </div>
              {item.matched_files.length > 0 && (
                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                  {item.matched_files.join(", ")}
                </div>
              )}
              {item.status === "missing" && (
                <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, marginTop: 2 }}>
                  MISSING — required document not found
                </div>
              )}
              {item.status === "not_applicable" && (
                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                  Not required for this project type
                </div>
              )}
            </div>
            {item.confidence > 0 && <ConfBar value={item.confidence} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 4: Field Extraction ─────────────────────────────────────────────────

function StepExtract({ fields }: { fields: Record<string, ExtractedField> }) {
  const sorted = Object.values(fields).sort((a, b) => a.field_id.localeCompare(b.field_id));
  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", fontSize: 11, color: "#6B7280", fontWeight: 600, paddingBottom: 4, paddingLeft: 4 }}>Field</th>
            <th style={{ textAlign: "left", fontSize: 11, color: "#6B7280", fontWeight: 600, paddingBottom: 4 }}>Extracted Value</th>
            <th style={{ textAlign: "left", fontSize: 11, color: "#6B7280", fontWeight: 600, paddingBottom: 4, width: 180 }}>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => {
            const lowConf = f.confidence < 0.6 || f.value === null;
            return (
              <tr key={f.field_id}>
                <td
                  style={{
                    padding: "8px 4px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#374151",
                    whiteSpace: "nowrap",
                    paddingRight: 12,
                  }}
                >
                  <span
                    style={{
                      background: "#E6F4F6",
                      color: "#005E6E",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                      fontSize: 11,
                      marginRight: 6,
                    }}
                  >
                    {f.field_id}
                  </span>
                  {f.name}
                </td>
                <td style={{ padding: "8px 12px 8px 0", fontSize: 13 }}>
                  {f.value !== null && f.value !== undefined ? (
                    <span
                      style={{
                        background: lowConf ? "#FEF3C7" : "#F0FDF4",
                        color: lowConf ? "#92400E" : "#065F46",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {String(f.value)}
                    </span>
                  ) : (
                    <span style={{ color: "#DC2626", fontSize: 12, fontStyle: "italic" }}>
                      Could not extract — manual entry required
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 4px" }}>
                  <ConfBar value={f.confidence} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Step 5: Rules Evaluation ─────────────────────────────────────────────────

function StepRules({ findings }: { findings: Finding[] }) {
  return (
    <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      {ALL_RULE_IDS.map((ruleId) => {
        const meta = RULE_META[ruleId];
        const fired = findings.filter((f) => f.rule_id === ruleId);
        const passed = fired.length === 0;

        if (passed) {
          return (
            <div
              key={ruleId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "#F0FDF4",
                border: "1px solid #D1FAE5",
                borderRadius: 6,
              }}
            >
              <span style={{ fontSize: 16, color: "#059669" }}>✓</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#059669", fontWeight: 700, minWidth: 46 }}>
                {ruleId}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#065F46" }}>{meta.label}</span>
              <span style={{ fontSize: 12, color: "#6B7280", marginLeft: "auto" }}>PASSED</span>
            </div>
          );
        }

        return (
          <div key={ruleId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {fired.map((f, i) => {
              const sc = severityColor(f.severity);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    background: sc.bg,
                    border: `1px solid ${sc.border}40`,
                    borderLeft: `4px solid ${sc.border}`,
                    borderRadius: 6,
                  }}
                >
                  <span style={{ fontSize: 16, color: sc.text, flexShrink: 0 }}>{sc.icon}</span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: sc.text,
                      fontWeight: 700,
                      minWidth: 46,
                      flexShrink: 0,
                    }}
                  >
                    {ruleId}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: sc.text }}>{meta.label}</div>
                    <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>{f.message}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: sc.text,
                      background: `${sc.border}20`,
                      padding: "2px 8px",
                      borderRadius: 10,
                      textTransform: "uppercase" as const,
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    {f.severity.replace("_", " ")}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 6: Routing Decision ─────────────────────────────────────────────────

function StepDecision({ basket, missingCount, missingCategories, findings }: {
  basket: string | null;
  missingCount: number;
  missingCategories: string[];
  findings: Finding[];
}) {
  const warnings = findings.filter((f) => ["warning", "error"].includes(f.severity));
  const isComplete = basket === "complete";
  const isIncomplete = basket === "incomplete";

  const colors = isComplete
    ? { bg: "#F0FDF4", border: "#16A34A", text: "#15803D", chipBg: "#DCFCE7" }
    : isIncomplete
    ? { bg: "#FFFBEB", border: "#D97706", text: "#92400E", chipBg: "#FEF3C7" }
    : { bg: "#FEF2F2", border: "#DC2626", text: "#991B1B", chipBg: "#FEE2E2" };

  const label = isComplete ? "COMPLETE" : isIncomplete ? "INCOMPLETE" : "DECLINE BASKET";
  const emoji = isComplete ? "✅" : isIncomplete ? "⚠️" : "🚫";

  return (
    <div style={{ padding: "4px 16px 20px" }}>
      <div
        style={{
          padding: 20,
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <span style={{ fontSize: 32 }}>{emoji}</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Routing Decision
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: colors.text,
                background: colors.chipBg,
                padding: "4px 16px",
                borderRadius: 8,
                display: "inline-block",
              }}
            >
              {label}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: colors.text, fontWeight: 700, minWidth: 140 }}>Documents Missing:</span>
            <span style={{ color: missingCount > 0 ? "#DC2626" : "#059669", fontWeight: 600 }}>
              {missingCount === 0 ? "None — all categories matched" : `${missingCount} (${missingCategories.join(", ")})`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: colors.text, fontWeight: 700, minWidth: 140 }}>Warnings / Flags:</span>
            <span style={{ color: warnings.length > 0 ? "#D97706" : "#059669", fontWeight: 600 }}>
              {warnings.length === 0 ? "None" : `${warnings.length} finding(s) flagged for officer review`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: colors.text, fontWeight: 700, minWidth: 140 }}>Next Step:</span>
            <span style={{ color: "#374151" }}>
              {isComplete
                ? "Application forwarded to PacifiCan officer for assessment review"
                : isIncomplete
                ? "Document request email drafted — awaiting officer review and dispatch to applicant"
                : "Case queued for manager confirmation before any decline action is taken"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props { c: Case }

type StepKey = "intake" | "classify" | "checklist" | "extract" | "rules" | "decision";

export default function ChainOfThought({ c }: Props) {
  const [open, setOpen] = useState<Record<StepKey, boolean>>({
    intake: true,
    classify: true,
    checklist: true,
    extract: false,
    rules: false,
    decision: true,
  });

  const toggle = (k: StepKey) => setOpen((prev) => ({ ...prev, [k]: !prev[k] }));

  const hasMissing = c.missing_count > 0;
  const hasWarnings = c.findings.some((f) => ["warning", "error"].includes(f.severity));
  const isDecline = c.basket === "decline_basket";

  const checklistOk = !hasMissing;
  const rulesOk = !hasWarnings;
  const declineColor = isDecline ? "#DC2626" : c.basket === "incomplete" ? "#D97706" : "#059669";

  const STEPS: Array<{
    key: StepKey;
    num: number;
    icon: string;
    title: string;
    statusIcon: string;
    color: string;
    content: React.ReactNode;
  }> = [
    {
      key: "intake",
      num: 1,
      icon: "📂",
      title: `Document Intake — ${c.documents.length} file${c.documents.length !== 1 ? "s" : ""} received`,
      statusIcon: "✓",
      color: "#005E6E",
      content: <StepIntake docs={c.documents} />,
    },
    {
      key: "classify",
      num: 2,
      icon: "🔍",
      title: "Document Classification — matching files to required categories",
      statusIcon: "✓",
      color: "#2563EB",
      content: <StepClassify docs={c.documents} />,
    },
    {
      key: "checklist",
      num: 3,
      icon: "📋",
      title: `Completeness Check — ${hasMissing ? `${c.missing_count} missing` : "all categories present"}`,
      statusIcon: hasMissing ? "⚠" : "✓",
      color: checklistOk ? "#059669" : "#D97706",
      content: <StepChecklist checklist={c.checklist} />,
    },
    {
      key: "extract",
      num: 4,
      icon: "📊",
      title: "Field Extraction — parsing key application data",
      statusIcon: c.findings.some((f) => f.rule_id === "R-009") ? "⚠" : "✓",
      color: "#7C3AED",
      content: <StepExtract fields={c.extracted_fields} />,
    },
    {
      key: "rules",
      num: 5,
      icon: "⚖️",
      title: `Rules Evaluation — ${hasWarnings ? `${c.findings.filter((f) => ["warning","error"].includes(f.severity)).length} flag(s) raised` : "all checks passed"}`,
      statusIcon: rulesOk ? "✓" : "⚠",
      color: rulesOk ? "#059669" : "#D97706",
      content: <StepRules findings={c.findings} />,
    },
    {
      key: "decision",
      num: 6,
      icon: "🎯",
      title: "Routing Decision",
      statusIcon: isDecline ? "🚫" : hasMissing ? "⚠" : "✓",
      color: declineColor,
      content: (
        <StepDecision
          basket={c.basket}
          missingCount={c.missing_count}
          missingCategories={c.missing_categories}
          findings={c.findings}
        />
      ),
    },
  ];

  return (
    <div style={{ marginTop: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: "2px solid #E5E7EB",
        }}
      >
        <span style={{ fontSize: 24 }}>🧠</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#111827" }}>AI Decision Trace</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>
            How the system evaluated your application — step by step
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ position: "relative" }}>
        {/* Vertical connector */}
        <div
          style={{
            position: "absolute",
            left: 29,
            top: 28,
            bottom: 28,
            width: 2,
            background: "linear-gradient(to bottom, #E5E7EB, #E5E7EB)",
            zIndex: 0,
          }}
        />

        {STEPS.map((step, idx) => (
          <div
            key={step.key}
            style={{
              position: "relative",
              zIndex: 1,
              marginBottom: idx < STEPS.length - 1 ? 8 : 0,
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              transition: "box-shadow 0.15s",
            }}
          >
            <StepHeader
              num={step.num}
              icon={step.icon}
              title={step.title}
              statusIcon={step.statusIcon}
              statusColor={step.color}
              open={open[step.key]}
              onToggle={() => toggle(step.key)}
            />
            {open[step.key] && (
              <div
                style={{
                  borderTop: `1px solid #F3F4F6`,
                  animation: "fadeIn 0.2s ease",
                }}
              >
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
