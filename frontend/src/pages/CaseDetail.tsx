import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  getCase, patchField, patchEmailDraft, markEmailReviewed, sendEmail,
  recordManagerDecision,
} from "../api";
import type { Case, Finding, ChecklistItem, EligibilityFlag, AuditEvent } from "../api";

// ---- Helpers ----------------------------------------------------------------

function BasketChip({ basket }: { basket: string | null }) {
  if (!basket) return null;
  const labels: Record<string, string> = { complete: "Complete", incomplete: "Incomplete", decline_basket: "Decline Basket" };
  return <span className={`chip chip-${basket}`}>{labels[basket] ?? basket}</span>;
}

function ConfBadge({ conf }: { conf: number }) {
  const pct = Math.round(conf * 100);
  const cls = conf >= 0.85 ? "conf-high" : conf >= 0.60 ? "conf-med" : "conf-low";
  return <span className={cls}>{pct}%</span>;
}

function SevIcon({ sev }: { sev: string }) {
  const icons: Record<string, string> = { warning: "⚠", error: "✕", info: "ℹ", manual_review: "✎" };
  return <span className={`sev-${sev}`}>{icons[sev] ?? "·"}</span>;
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    present: ["✓ Present", "doc-present"],
    missing: ["✗ Missing", "doc-missing"],
    uncertain: ["? Uncertain", "doc-uncertain"],
    not_applicable: ["N/A", "doc-na"],
  };
  const [label, cls] = map[status] ?? [status, ""];
  return <span className={cls}>{label}</span>;
}

function EligChip({ status }: { status: string }) {
  return <span className={`chip chip-${status}`}>{status.replace("_", " ")}</span>;
}

function formatVal(val: unknown): string {
  if (val === null || val === undefined) return "Not found";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return `$${val.toLocaleString()}`;
  if (typeof val === "object") {
    const o = val as Record<string, unknown>;
    // Location object
    if ("province" in o) return `${o.province}${o.bc_operating_facilities !== undefined ? ` — BC facility: ${o.bc_operating_facilities ? "Yes" : "No"}` : ""}`;
    // Funding object
    if ("amount" in o) return `$${(o.amount as number).toLocaleString()} (Confirmation: ${o.confirmation_present ? "Present" : "Not found"})`;
    // Project period
    if ("start_date" in o) return `${o.start_date} to ${o.end_date}`;
    return JSON.stringify(val);
  }
  return String(val);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

// ---- Sub-panels -------------------------------------------------------------

function CaseHeader({ c }: { c: Case }) {
  const df01 = c.extracted_fields?.["DF-01"];
  const name = df01?.value && typeof df01.value === "string" ? df01.value : "Unknown Applicant";
  return (
    <div className="card">
      <div className="card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="text-muted text-sm mb-2" style={{ marginBottom: 6 }}>Case ID: <code>{c.case_id}</code></div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{name}</h2>
          <div className="flex gap-3 items-center">
            <BasketChip basket={c.basket} />
            <span className="text-sm text-muted">Submitted: {formatDate(c.submission_timestamp)}</span>
            <span className="text-sm text-muted">Status: {c.status.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          {c.missing_count > 0 && (
            <div className="text-sm" style={{ color: "#B91C1C", fontWeight: 600 }}>
              {c.missing_count} document{c.missing_count !== 1 ? "s" : ""} missing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractedFieldsPanel({ c, onRefresh }: { c: Case; onRefresh: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [newVal, setNewVal] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fields = Object.values(c.extracted_fields || {});

  const save = async (fieldId: string) => {
    if (!reason.trim()) { setErr("Reason note is required."); return; }
    setSaving(true); setErr(null);
    try {
      await patchField(c.case_id, fieldId, newVal, reason);
      setEditing(null); setNewVal(""); setReason("");
      onRefresh();
    } catch {
      setErr("Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <div className="card-header">📋 Extracted Fields (7 Key Fields)</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>ID</th>
            <th>Field</th>
            <th>Value</th>
            <th style={{ width: 100 }}>Source</th>
            <th style={{ width: 80 }}>Confidence</th>
            <th style={{ width: 80 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const isLowConf = f.confidence < 0.60;
            return (
              <>
                <tr key={f.field_id} style={isLowConf ? { background: "#FEF3C7" } : {}}>
                  <td><code className="text-xs">{f.field_id}</code></td>
                  <td className="fw-600">{f.name}</td>
                  <td>
                    {f.value === null || f.value === undefined
                      ? <span style={{ color: "#B91C1C", fontWeight: 600 }}>Not found ⚠</span>
                      : <span>{formatVal(f.value)}</span>
                    }
                    {f.manually_corrected && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>[edited]</span>}
                  </td>
                  <td className="text-xs text-muted">{f.source_doc_id ?? "—"}</td>
                  <td><ConfBadge conf={f.confidence} /></td>
                  <td>
                    {editing !== f.field_id
                      ? <button className="btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setEditing(f.field_id); setNewVal(formatVal(f.value)); }}>Edit</button>
                      : <button className="btn-secondary" style={{ padding: "3px 10px", fontSize: 12, color: "#DC2626" }} onClick={() => setEditing(null)}>Cancel</button>
                    }
                  </td>
                </tr>
                {editing === f.field_id && (
                  <tr key={`${f.field_id}-edit`}>
                    <td colSpan={6} style={{ background: "#F0FDF4", padding: 16 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <label>New Value</label>
                          <input value={newVal} onChange={(e) => setNewVal(e.target.value)} />
                        </div>
                        <div>
                          <label>Reason Note (required)</label>
                          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this correction needed?" />
                        </div>
                      </div>
                      {err && <div className="text-sm" style={{ color: "#DC2626", marginTop: 8 }}>{err}</div>}
                      <div className="flex gap-2 mt-2">
                        <button className="btn-primary" onClick={() => save(f.field_id)} disabled={saving}>{saving ? "Saving…" : "Save Correction"}</button>
                        <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocumentChecklistPanel({ checklist }: { checklist: ChecklistItem[] }) {
  return (
    <div className="card">
      <div className="card-header">📁 Document Checklist</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th>Category</th>
            <th style={{ width: 120 }}>Status</th>
            <th>Matched Files</th>
            <th style={{ width: 90 }}>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {checklist.map((item) => (
            <tr key={item.doc_id}>
              <td><code className="text-xs">{item.doc_id}</code></td>
              <td>{item.category}</td>
              <td><DocStatusBadge status={item.status} /></td>
              <td className="text-sm">
                {item.matched_files.length > 0
                  ? item.matched_files.map((f, i) => <div key={i}><code>{f}</code></div>)
                  : <span className="text-muted">—</span>
                }
                {item.notes && <div className="text-xs text-muted mt-2">{item.notes}</div>}
              </td>
              <td>{item.status !== "missing" && item.status !== "not_applicable" ? <ConfBadge conf={item.confidence} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return (
    <div className="card">
      <div className="card-header">⚠ Findings &amp; Warnings</div>
      <div className="card-body text-muted">No findings. All checks passed.</div>
    </div>
  );
  return (
    <div className="card">
      <div className="card-header">⚠ Findings &amp; Warnings ({findings.length})</div>
      <div className="card-body" style={{ paddingTop: 8 }}>
        {findings.map((f, i) => {
          const alertClass = f.severity === "warning" ? "alert-warning" : f.severity === "error" ? "alert-error" : f.severity === "manual_review" ? "alert-manual" : "alert-info";
          return (
            <div key={i} className={`alert ${alertClass}`}>
              <SevIcon sev={f.severity} />
              <div>
                <div className="text-sm fw-600" style={{ textTransform: "capitalize" }}>{f.severity.replace("_", " ")} · {f.rule_id}</div>
                <div className="text-sm">{f.message}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EligibilityFlagsPanel({ flags }: { flags: EligibilityFlag[] }) {
  return (
    <div className="card">
      <div className="card-header">🏁 Eligibility Alignment Flags</div>
      <div className="card-body">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {flags.map((f) => (
            <div key={f.flag_id} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 14px", minWidth: 160 }}>
              <div className="text-xs text-muted mb-2">{f.flag_id}</div>
              <div className="fw-600 text-sm mb-2" style={{ marginBottom: 6 }}>{f.label}</div>
              <EligChip status={f.status} />
              {f.detail && <div className="text-xs text-muted mt-2" style={{ maxWidth: 200 }}>{f.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ c }: { c: Case }) {
  return (
    <div className="card">
      <div className="card-header">📄 Uploaded Files</div>
      <div className="card-body">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {c.documents.map((d) => (
            <div key={d.file_id} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "10px 14px", minWidth: 180 }}>
              <div className="fw-600 text-sm">{d.name}</div>
              <div className="text-xs text-muted">{(d.size_bytes / 1024).toFixed(1)} KB · {d.extension.toUpperCase()}</div>
              {d.detected_doc_type
                ? <div className="text-xs" style={{ color: "#005E6E", marginTop: 4 }}>→ {d.detected_doc_type} <ConfBadge conf={d.confidence} /></div>
                : <div className="text-xs text-muted mt-2">Unclassified</div>
              }
              {d.notes && <div className="text-xs" style={{ color: "#D97706", marginTop: 4 }}>⚠ {d.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecommendedAction({ c, onRefresh }: { c: Case; onRefresh: () => void }) {
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: "confirm" | "return_to_incomplete" | "override_complete") => {
    if (!comment.trim()) { setErr("Comment is required."); return; }
    setActing(true); setErr(null);
    try {
      await recordManagerDecision(c.case_id, decision, comment);
      setComment(""); onRefresh();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Action failed.");
    } finally { setActing(false); }
  };

  if (c.basket === "complete") {
    return (
      <div className="card">
        <div className="card-header">✅ Recommended Action</div>
        <div className="card-body">
          <div className="alert alert-success"><span>✓</span> <strong>Ready for Assessment Review.</strong> This application package is complete. Forward to the programme officer for substantive review.</div>
        </div>
      </div>
    );
  }

  if (c.basket === "incomplete") {
    return (
      <div className="card">
        <div className="card-header">📧 Recommended Action</div>
        <div className="card-body">
          <div className="alert alert-warning"><span>⚠</span> <strong>Document Request Required.</strong> {c.missing_count} document{c.missing_count !== 1 ? "s" : ""} missing. Review and send the draft email below.</div>
        </div>
      </div>
    );
  }

  if (c.basket === "decline_basket") {
    if (c.manager_confirmed) {
      return (
        <div className="card">
          <div className="card-header">⛔ Manager Decision Recorded</div>
          <div className="card-body">
            <div className="alert alert-error"><span>⛔</span> Manager has confirmed decline routing. Decision: <strong>{c.manager_decision}</strong></div>
          </div>
        </div>
      );
    }
    return (
      <div className="card">
        <div className="card-header">🔐 Manager Confirmation Required</div>
        <div className="card-body">
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <span>⛔</span>
            <div>
              <strong>Decline Basket — {c.missing_count} documents missing.</strong>
              <div className="text-sm mt-2">Missing: {c.missing_categories.join(", ")}</div>
              <div className="text-sm mt-2">All decline actions are disabled until a manager records a decision.</div>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Manager Comment (required)</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Enter rationale for decision…" style={{ minHeight: 80 }} />
          </div>
          {err && <div className="text-sm" style={{ color: "#DC2626", marginBottom: 8 }}>{err}</div>}
          <div className="flex gap-2">
            <button className="btn-danger" onClick={() => decide("confirm")} disabled={acting}>
              {acting ? "Saving…" : "Confirm Decline Routing"}
            </button>
            <button className="btn-secondary" onClick={() => decide("return_to_incomplete")} disabled={acting}>
              Return to Incomplete
            </button>
            <button className="btn-primary" onClick={() => decide("override_complete")} disabled={acting}>
              Override to Complete
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function DraftEmailEditor({ c, onRefresh }: { c: Case; onRefresh: () => void }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (c.email_draft) setBody(c.email_draft.body);
  }, [c.email_draft]);

  if (!c.email_draft) return null;
  const draft = c.email_draft;

  const save = async () => {
    setSaving(true); setErr(null);
    try { await patchEmailDraft(c.case_id, body); onRefresh(); }
    catch { setErr("Save failed."); }
    finally { setSaving(false); }
  };

  const review = async () => {
    setSaving(true); setErr(null);
    try { await markEmailReviewed(c.case_id); onRefresh(); }
    catch { setErr("Failed to mark as reviewed."); }
    finally { setSaving(false); }
  };

  const send = async () => {
    setSending(true); setErr(null);
    try { await sendEmail(c.case_id); onRefresh(); }
    catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Send failed.");
    } finally { setSending(false); }
  };

  return (
    <div className="card">
      <div className="card-header">
        📧 Draft Document Request Email
        {draft.sent && <span className="chip chip-complete" style={{ marginLeft: 8 }}>Sent</span>}
        {draft.reviewed && !draft.sent && <span className="chip chip-ok" style={{ marginLeft: 8 }}>Reviewed</span>}
        {!draft.reviewed && !draft.sent && <span className="chip" style={{ marginLeft: 8, background: "#F3F4F6", color: "#6B7280" }}>Pending Review</span>}
      </div>
      <div className="card-body">
        {draft.sent
          ? <div className="alert alert-success"><span>✓</span> Email sent at {draft.sent_at ? formatDate(draft.sent_at) : "—"}</div>
          : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label>Subject</label>
                <input value={draft.subject} readOnly style={{ background: "#F9FAFB" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Email Body <span className="text-muted text-xs">(editable)</span></label>
                <textarea
                  className="email-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={draft.sent}
                />
              </div>
              {err && <div className="text-sm" style={{ color: "#DC2626", marginBottom: 8 }}>{err}</div>}
              <div className="flex gap-2">
                {!draft.reviewed && (
                  <>
                    <button className="btn-secondary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Edits"}</button>
                    <button className="btn-primary" onClick={review} disabled={saving}>Mark as Reviewed ✓</button>
                  </>
                )}
                {draft.reviewed && (
                  <button className="btn-primary" onClick={send} disabled={sending || draft.sent}>
                    {sending ? "Sending…" : "Send Email"}
                  </button>
                )}
                {!draft.reviewed && (
                  <span className="text-sm text-muted" style={{ alignSelf: "center" }}>
                    ⚠ Must be reviewed before sending
                  </span>
                )}
              </div>
            </>
          )
        }
      </div>
    </div>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  return (
    <div className="card">
      <div className="card-header">🕓 Audit Timeline</div>
      <div className="card-body">
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.event_id}>
              <div className="timeline-ts">{formatDate(e.timestamp)}</div>
              <div className="timeline-type">{e.event_type.replace(/_/g, " ")}</div>
              <div className="timeline-actor">By: {e.actor}</div>
              {Object.keys(e.details).length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary className="text-xs text-muted" style={{ cursor: "pointer" }}>Details</summary>
                  <pre className="text-xs" style={{ marginTop: 4, background: "#F9FAFB", padding: 8, borderRadius: 4, overflow: "auto" }}>
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---- Main page --------------------------------------------------------------

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getCase(id)
      .then(setCaseData)
      .catch(() => setErr("Failed to load case."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-muted" style={{ padding: 40 }}>Loading…</div>;
  if (err || !caseData) return <div className="alert alert-error">{err ?? "Case not found."}</div>;

  const c = caseData;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2" style={{ marginBottom: 16 }}>
        <a href="/" style={{ color: "#6B7280", fontSize: 13 }}>← Dashboard</a>
      </div>

      <CaseHeader c={c} />
      <RecommendedAction c={c} onRefresh={load} />

      <div className="grid-2">
        <ExtractedFieldsPanel c={c} onRefresh={load} />
        <div>
          <WarningsPanel findings={c.findings} />
          <EligibilityFlagsPanel flags={c.eligibility_flags} />
        </div>
      </div>

      <DocumentChecklistPanel checklist={c.checklist} />
      {c.basket === "incomplete" && <DraftEmailEditor c={c} onRefresh={load} />}
      <DocumentViewer c={c} />
      <AuditTimeline events={c.audit_trail} />
    </div>
  );
}
