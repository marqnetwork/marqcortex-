-- ============================================================================
-- MCV2-S3 DESIGN ARTIFACT — NON-EXECUTABLE
-- Sprint: MCV2-S3-DATABASE-ARCHITECTURE
-- Purpose: Illustrative schema for Sprint 2 (submissions core / KV migration)
-- WARNING: Do not apply to production. For planning review only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS diagnostic_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  legacy_kv_key     TEXT,
  email             TEXT NOT NULL,
  capture_source    TEXT NOT NULL,
  utm_data          JSONB DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'new',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  legacy_id         VARCHAR(64) UNIQUE,  -- SUB-* from KV
  legacy_kv_key     TEXT,
  diagnostic_lead_id UUID REFERENCES diagnostic_leads(id),
  contact_name      TEXT NOT NULL,
  contact_email     TEXT NOT NULL,
  contact_phone     TEXT,
  company_name      TEXT NOT NULL,
  company_website   TEXT,
  industry_id       TEXT NOT NULL,
  industry_label    TEXT,
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','in-review','completed','approved')),
  priority          TEXT NOT NULL DEFAULT 'medium',
  completion_score  INT,
  quality_score     INT,
  ai_score          INT,
  answers_json      JSONB NOT NULL DEFAULT '{}',
  engagement_json   JSONB DEFAULT '{}',
  assigned_to       UUID REFERENCES auth.users(id),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS submission_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  submission_id     UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  legacy_kv_key     TEXT,
  note_type         TEXT NOT NULL DEFAULT 'note',
  body              TEXT NOT NULL,
  author_id         UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  submission_id     UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta_json         JSONB DEFAULT '{}'
);

-- Indexes for dashboard query patterns (Stage 7)
CREATE INDEX IF NOT EXISTS idx_submissions_org_status_submitted
  ON submissions (organization_id, status, submitted_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_org_email_active
  ON submissions (organization_id, lower(contact_email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_submission_occurred
  ON engagement_events (submission_id, occurred_at DESC);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_events ENABLE ROW LEVEL SECURITY;
