/**
 * S6.3 disposable KV validation fixtures — synthetic only
 */
export const S6VALIDATE_FIXTURE_TAG = 's6validate';

export interface FixtureRecord {
  key: string;
  value: unknown;
  expectedClassification:
    | 'migrated'
    | 'duplicate'
    | 'quarantined'
    | 'index_only';
  description: string;
}

const SHARED_EMAIL = 'primary@test.s6validate.marq';
const DUP_EMAIL = 'dup@test.s6validate.marq';

export const S6VALIDATE_FIXTURES: FixtureRecord[] = [
  {
    key: 'lead:s6validate:001-normal',
    value: {
      id: 's6validate_001',
      name: 'Validate Normal',
      email: SHARED_EMAIL,
      phone: '+1-555-9001',
      website: 'https://validate-001.test',
      source: 'lead_magnet',
      capturedAt: '2026-01-10T10:00:00.000Z',
    },
    expectedClassification: 'migrated',
    description: 'Valid lead magnet JSON object',
  },
  {
    key: 'lead:s6validate:002-double',
    value: JSON.stringify({
      id: 's6validate_002',
      name: 'Validate Double',
      email: 'double@test.s6validate.marq',
      source: 'lead_magnet',
      capturedAt: '2026-01-11T10:00:00.000Z',
    }),
    expectedClassification: 'migrated',
    description: 'Double-encoded JSON string value',
  },
  {
    key: 'lead:s6validate:003-dup-email',
    value: {
      id: 's6validate_003',
      name: 'Validate Dup',
      email: SHARED_EMAIL,
      source: 'lead_magnet',
      capturedAt: '2026-01-12T10:00:00.000Z',
    },
    expectedClassification: 'duplicate',
    description: 'Duplicate email vs 001-normal',
  },
  {
    key: 'lead:s6validate:004-noemail',
    value: {
      id: 's6validate_004',
      name: 'No Email',
      source: 'lead_magnet',
      capturedAt: '2026-01-12T11:00:00.000Z',
    },
    expectedClassification: 'quarantined',
    description: 'Missing required email',
  },
  {
    key: 'lead:s6validate:005-malformed',
    value: '{not-valid-json',
    expectedClassification: 'quarantined',
    description: 'Malformed JSON string',
  },
  {
    key: 'lead:s6validate:006-minimal',
    value: {
      id: 's6validate_006',
      email: 'minimal@test.s6validate.marq',
      source: 'exit_intent',
    },
    expectedClassification: 'migrated',
    description: 'Optional fields missing',
  },
  {
    key: 'lead:s6validate:007-timestamp',
    value: {
      id: 's6validate_007',
      email: 'timestamp@test.s6validate.marq',
      source: 'lead_magnet',
      capturedAt: '2025-12-25T00:00:00.000Z',
    },
    expectedClassification: 'migrated',
    description: 'Explicit capturedAt timestamp',
  },
  {
    key: 'lead:s6validate:008-normalize',
    value: {
      id: 's6validate_008',
      name: '  Pat Example  ',
      email: '  NORMALIZE@test.s6validate.marq  ',
      phone: '   ',
      website: '',
      source: 'lead_magnet',
      capturedAt: '2026-01-13T09:00:00.000Z',
    },
    expectedClassification: 'migrated',
    description: 'Requires deterministic normalization',
  },
  {
    key: 'lead_email:s6validate:primary@test.s6validate.marq',
    value: 's6validate_001',
    expectedClassification: 'index_only',
    description: 'Email index for 001-normal',
  },
  {
    key: 'lead_email:s6validate:orphan@test.s6validate.marq',
    value: 's6validate_missing_lead',
    expectedClassification: 'index_only',
    description: 'Orphaned lead_email mapping',
  },
];

export function fixtureEntityKeys(): string[] {
  return S6VALIDATE_FIXTURES.filter((f) => f.key.startsWith('lead:s6validate:')).map((f) => f.key);
}

export function expectedMigratedCount(): number {
  return S6VALIDATE_FIXTURES.filter((f) => f.expectedClassification === 'migrated').length;
}

export function expectedQuarantinedCount(): number {
  return S6VALIDATE_FIXTURES.filter((f) => f.expectedClassification === 'quarantined').length;
}

export function expectedDuplicateCount(): number {
  return S6VALIDATE_FIXTURES.filter((f) => f.expectedClassification === 'duplicate').length;
}
