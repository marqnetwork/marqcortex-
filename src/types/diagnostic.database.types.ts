/**
 * Diagnostic domain database types — MCV2-S5-IMPLEMENT-002
 * Shared reference types only; no runtime DB access from frontend.
 */

export type LeadStatus = 'new' | 'captured' | 'exit_intent' | 'converted' | 'archived';
export type ContactMethodType = 'email' | 'phone' | 'website' | 'other';
export type SubmissionStatus =
  | 'new'
  | 'under_review'
  | 'report_ready'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'archived';
export type SubmissionPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ReportStatus = 'draft' | 'generating' | 'ready' | 'published' | 'archived';
export type OutcomeType = 'engagement' | 'won' | 'lost' | 'nurture' | 'other';
export type OutcomeStatus = 'open' | 'closed' | 'archived';

export interface AuditColumns {
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface SoftDeleteColumns {
  deleted_at: string | null;
}

export interface LeadSourceRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface LeadRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  lead_source_id: string | null;
  contact_id: string | null;
  legacy_kv_key: string | null;
  legacy_id: string | null;
  email: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  status: LeadStatus;
  metadata: Record<string, unknown>;
  captured_at: string;
}

export interface LeadTagRecord {
  id: string;
  organization_id: string;
  lead_id: string;
  tag: string;
  created_at: string;
  created_by: string | null;
}

export interface ContactRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  legacy_kv_key: string | null;
  full_name: string | null;
  company_name: string | null;
  primary_email: string | null;
  metadata: Record<string, unknown>;
}

export interface ContactMethodRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  contact_id: string;
  method_type: ContactMethodType;
  value: string;
  is_primary: boolean;
}

export interface SubmissionRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  lead_id: string | null;
  contact_id: string | null;
  legacy_kv_key: string | null;
  legacy_id: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  industry_id: string | null;
  status: SubmissionStatus;
  priority: SubmissionPriority;
  completion_score: number | null;
  quality_score: number | null;
  ai_score: number | null;
  roi_potential: string | null;
  assigned_to: string | null;
  submitted_at: string;
  metadata: Record<string, unknown>;
}

export interface SubmissionSectionRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  section_key: string;
  title: string | null;
  sort_order: number;
  status: string;
  metadata: Record<string, unknown>;
}

export interface DiagnosticAnswerRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  section_id: string | null;
  question_key: string;
  answer_text: string | null;
  answer_json: Record<string, unknown> | null;
}

export interface DiagnosticScoreRecord extends AuditColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  completion_score: number | null;
  quality_score: number | null;
  ai_score: number | null;
  readiness_score: number | null;
  scored_at: string;
  metadata: Record<string, unknown>;
}

export interface DomainScoreRecord extends AuditColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  domain_key: string;
  score: number;
  weight: number | null;
  metadata: Record<string, unknown>;
}

export interface ReportRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  status: ReportStatus;
  title: string | null;
  current_version: number;
  metadata: Record<string, unknown>;
}

export interface ReportVersionRecord {
  id: string;
  organization_id: string;
  report_id: string;
  version_number: number;
  content: Record<string, unknown>;
  generated_at: string;
  generated_by: string | null;
  is_published: boolean;
  created_at: string;
  created_by: string | null;
}

export interface OutcomeRecord extends AuditColumns, SoftDeleteColumns {
  id: string;
  organization_id: string;
  submission_id: string;
  legacy_kv_key: string | null;
  outcome_type: OutcomeType;
  status: OutcomeStatus;
  value: Record<string, unknown>;
  recorded_at: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface SubmissionListFilter extends ListOptions {
  organizationId: string;
  status?: SubmissionStatus;
  priority?: SubmissionPriority;
}

export interface LeadListFilter extends ListOptions {
  organizationId: string;
  status?: LeadStatus;
  email?: string;
}

export interface ContactListFilter extends ListOptions {
  organizationId: string;
  primaryEmail?: string;
}

export interface ReportListFilter extends ListOptions {
  organizationId: string;
  submissionId?: string;
  status?: ReportStatus;
}

export interface OutcomeListFilter extends ListOptions {
  organizationId: string;
  submissionId?: string;
  status?: OutcomeStatus;
}
