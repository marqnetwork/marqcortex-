/**
 * Tenancy repository types — server-side only (MCV2-S4-IMPLEMENT-001)
 */

import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
  OrganizationSettingsRecord,
  MembershipWithPermissions,
} from '../../../../src/types/database.types.ts';

export class TenancyRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'MISSING_ORGANIZATION'
      | 'MISSING_MEMBERSHIP'
      | 'MISSING_ROLE'
      | 'MISSING_PERMISSION'
      | 'DATABASE_ERROR',
  ) {
    super(message);
    this.name = 'TenancyRepositoryError';
  }
}

export interface TenancyRepository {
  getOrganizationById(id: string): Promise<OrganizationRecord | null>;
  getOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
  listUserMemberships(userId: string): Promise<OrganizationMembershipRecord[]>;
  isOrganizationMember(userId: string, organizationId: string): Promise<boolean>;
  resolveMembershipWithPermissions(
    userId: string,
    organizationId: string,
  ): Promise<MembershipWithPermissions | null>;
  getOrganizationSettings(organizationId: string): Promise<OrganizationSettingsRecord | null>;
  updateOrganizationSettings(
    organizationId: string,
    settings: Record<string, unknown>,
    updatedBy: string,
  ): Promise<OrganizationSettingsRecord>;
}
