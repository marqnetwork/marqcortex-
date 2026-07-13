/**
 * Diagnostic repository contracts — server-side only (MCV2-S5-IMPLEMENT-002)
 */

import type {
  ContactListFilter,
  ContactMethodRecord,
  ContactRecord,
  DiagnosticAnswerRecord,
  DiagnosticScoreRecord,
  DomainScoreRecord,
  LeadListFilter,
  LeadRecord,
  LeadSourceRecord,
  LeadTagRecord,
  OutcomeListFilter,
  OutcomeRecord,
  ReportListFilter,
  ReportRecord,
  ReportVersionRecord,
  SubmissionListFilter,
  SubmissionRecord,
  SubmissionSectionRecord,
} from '../../../../src/types/diagnostic.database.types.ts';

export class DiagnosticRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'VALIDATION_ERROR'
      | 'CONFLICT'
      | 'DATABASE_ERROR',
  ) {
    super(message);
    this.name = 'DiagnosticRepositoryError';
  }
}

export interface LeadRepository {
  createLead(input: Partial<LeadRecord> & Pick<LeadRecord, 'organization_id' | 'email'>): Promise<LeadRecord>;
  getLeadById(id: string, organizationId: string): Promise<LeadRecord | null>;
  getLeadByLegacyKey(legacyKvKey: string): Promise<LeadRecord | null>;
  lookupLeadByEmail(organizationId: string, email: string): Promise<LeadRecord | null>;
  updateLead(id: string, organizationId: string, patch: Partial<LeadRecord>): Promise<LeadRecord>;
  listLeads(filter: LeadListFilter): Promise<LeadRecord[]>;
  listLeadSources(organizationId: string): Promise<LeadSourceRecord[]>;
  addLeadTag(leadId: string, organizationId: string, tag: string, createdBy?: string | null): Promise<LeadTagRecord>;
  listLeadTags(leadId: string, organizationId: string): Promise<LeadTagRecord[]>;
}

export interface ContactRepository {
  createContact(input: Partial<ContactRecord> & Pick<ContactRecord, 'organization_id'>): Promise<ContactRecord>;
  getContactById(id: string, organizationId: string): Promise<ContactRecord | null>;
  lookupContactByEmail(organizationId: string, email: string): Promise<ContactRecord | null>;
  updateContact(id: string, organizationId: string, patch: Partial<ContactRecord>): Promise<ContactRecord>;
  listContacts(filter: ContactListFilter): Promise<ContactRecord[]>;
  addContactMethod(
    input: Partial<ContactMethodRecord> & Pick<ContactMethodRecord, 'organization_id' | 'contact_id' | 'method_type' | 'value'>,
  ): Promise<ContactMethodRecord>;
  listContactMethods(contactId: string, organizationId: string): Promise<ContactMethodRecord[]>;
}

export interface SubmissionRepository {
  createSubmission(
    input: Partial<SubmissionRecord> & Pick<SubmissionRecord, 'organization_id' | 'company_name' | 'contact_email'>,
  ): Promise<SubmissionRecord>;
  getSubmissionById(id: string, organizationId: string): Promise<SubmissionRecord | null>;
  getSubmissionByLegacyKey(legacyKvKey: string): Promise<SubmissionRecord | null>;
  lookupSubmissionByEmail(organizationId: string, email: string): Promise<SubmissionRecord | null>;
  updateSubmission(id: string, organizationId: string, patch: Partial<SubmissionRecord>): Promise<SubmissionRecord>;
  listSubmissions(filter: SubmissionListFilter): Promise<SubmissionRecord[]>;
  upsertSection(
    input: Partial<SubmissionSectionRecord> & Pick<SubmissionSectionRecord, 'organization_id' | 'submission_id' | 'section_key'>,
  ): Promise<SubmissionSectionRecord>;
  listSections(submissionId: string, organizationId: string): Promise<SubmissionSectionRecord[]>;
  upsertAnswer(
    input: Partial<DiagnosticAnswerRecord> & Pick<DiagnosticAnswerRecord, 'organization_id' | 'submission_id' | 'question_key'>,
  ): Promise<DiagnosticAnswerRecord>;
  listAnswers(submissionId: string, organizationId: string): Promise<DiagnosticAnswerRecord[]>;
  upsertDiagnosticScore(
    input: Partial<DiagnosticScoreRecord> & Pick<DiagnosticScoreRecord, 'organization_id' | 'submission_id'>,
  ): Promise<DiagnosticScoreRecord>;
  upsertDomainScore(
    input: Partial<DomainScoreRecord> & Pick<DomainScoreRecord, 'organization_id' | 'submission_id' | 'domain_key' | 'score'>,
  ): Promise<DomainScoreRecord>;
  listDomainScores(submissionId: string, organizationId: string): Promise<DomainScoreRecord[]>;
}

export interface ReportRepository {
  createReport(
    input: Partial<ReportRecord> & Pick<ReportRecord, 'organization_id' | 'submission_id'>,
  ): Promise<ReportRecord>;
  getReportById(id: string, organizationId: string): Promise<ReportRecord | null>;
  getReportBySubmission(submissionId: string, organizationId: string): Promise<ReportRecord | null>;
  updateReport(id: string, organizationId: string, patch: Partial<ReportRecord>): Promise<ReportRecord>;
  listReports(filter: ReportListFilter): Promise<ReportRecord[]>;
  createReportVersion(
    input: Partial<ReportVersionRecord> & Pick<ReportVersionRecord, 'organization_id' | 'report_id' | 'version_number' | 'content'>,
  ): Promise<ReportVersionRecord>;
  getReportVersion(reportId: string, versionNumber: number, organizationId: string): Promise<ReportVersionRecord | null>;
  listReportVersions(reportId: string, organizationId: string): Promise<ReportVersionRecord[]>;
}

export interface OutcomeRepository {
  createOutcome(
    input: Partial<OutcomeRecord> & Pick<OutcomeRecord, 'organization_id' | 'submission_id'>,
  ): Promise<OutcomeRecord>;
  getOutcomeById(id: string, organizationId: string): Promise<OutcomeRecord | null>;
  getOutcomeBySubmission(submissionId: string, organizationId: string): Promise<OutcomeRecord | null>;
  getOutcomeByLegacyKey(legacyKvKey: string): Promise<OutcomeRecord | null>;
  updateOutcome(id: string, organizationId: string, patch: Partial<OutcomeRecord>): Promise<OutcomeRecord>;
  listOutcomes(filter: OutcomeListFilter): Promise<OutcomeRecord[]>;
}
