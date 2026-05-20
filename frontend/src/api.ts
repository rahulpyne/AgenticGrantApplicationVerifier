import axios from "axios";

const api = axios.create({ baseURL: "/api/v1" });

export interface Case {
  case_id: string;
  submission_timestamp: string;
  status: string;
  basket: "complete" | "incomplete" | "decline_basket" | null;
  missing_count: number;
  missing_categories: string[];
  documents: DocumentRecord[];
  checklist: ChecklistItem[];
  extracted_fields: Record<string, ExtractedField>;
  eligibility_flags: EligibilityFlag[];
  findings: Finding[];
  email_draft: EmailDraft | null;
  manager_confirmed: boolean;
  manager_decision: string | null;
  audit_trail: AuditEvent[];
  scenario_folder: string | null;
}

export interface DocumentRecord {
  file_id: string;
  name: string;
  extension: string;
  size_bytes: number;
  parse_status: string;
  detected_doc_type: string | null;
  confidence: number;
  matched_on: string;
  notes: string | null;
}

export interface ChecklistItem {
  doc_id: string;
  category: string;
  status: "present" | "missing" | "uncertain" | "not_applicable";
  matched_files: string[];
  confidence: number;
  notes: string | null;
}

export interface ExtractedField {
  field_id: string;
  name: string;
  value: unknown;
  source_doc_id: string | null;
  confidence: number;
  raw_excerpt: string | null;
  manually_corrected: boolean;
  correction_history: unknown[];
}

export interface EligibilityFlag {
  flag_id: string;
  label: string;
  status: "ok" | "flagged" | "needs_review";
  detail: string | null;
}

export interface Finding {
  id: string;
  severity: "error" | "warning" | "info" | "manual_review";
  message: string;
  rule_id: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  reviewed: boolean;
  sent: boolean;
  sent_at: string | null;
  sent_by: string | null;
}

export interface AuditEvent {
  event_id: string;
  case_id: string;
  timestamp: string;
  event_type: string;
  actor: string;
  details: Record<string, unknown>;
}

// API calls
export const getCases = () => api.get<Case[]>("/cases").then((r) => r.data);
export const getCase = (id: string) => api.get<Case>(`/cases/${id}`).then((r) => r.data);
export const submitCase = (scenarioFolder: string) =>
  api.post<Case>("/cases/submit", { scenario_folder: scenarioFolder }).then((r) => r.data);
export const getManagerQueue = () =>
  api.get<{ case_id: string; basket: string; applicant_name: string }[]>("/manager/queue").then((r) => r.data);

export const patchField = (caseId: string, fieldId: string, newValue: unknown, reasonNote: string) =>
  api.patch<Case>(`/cases/${caseId}/fields/${fieldId}`, { new_value: newValue, reason_note: reasonNote }).then((r) => r.data);

export const patchEmailDraft = (caseId: string, body: string, subject?: string) =>
  api.patch<Case>(`/cases/${caseId}/email-draft`, { body, subject }).then((r) => r.data);

export const markEmailReviewed = (caseId: string) =>
  api.post<Case>(`/cases/${caseId}/email-draft/mark-reviewed`, { officer_id: "officer-1" }).then((r) => r.data);

export const sendEmail = (caseId: string) =>
  api.post<Case>(`/cases/${caseId}/email-draft/send`, { officer_id: "officer-1" }).then((r) => r.data);

export const recordManagerDecision = (
  caseId: string,
  decision: "confirm" | "return_to_incomplete" | "override_complete",
  comment: string
) =>
  api.post<Case>(`/cases/${caseId}/manager-decision`, {
    decision,
    comment,
    manager_id: "manager-1",
  }).then((r) => r.data);

export interface SubmitResult {
  case_id: string;
  basket: "complete" | "incomplete" | "decline_basket" | null;
  status: string;
  missing_count: number;
  message: string;
}

export interface TestPackage {
  name: string;
  description: string;
}

export const submitApplication = (formData: FormData) =>
  api.post<SubmitResult>("/apply", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);

export const getTestPackages = () =>
  api.get<TestPackage[]>("/test-packages").then((r) => r.data);

export const testPackageDownloadUrl = (name: string) =>
  `/api/v1/test-packages/${name}/download`;
