-- ---------------------------------------------------------------------------
-- G2 — tenancy, enforced by the database rather than only by the code above it.
--
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- Every child table in the diagnostic domain carries `organization_id` AND a
-- foreign key to a parent that carries its own. Nothing said the two had to
-- agree. A row could therefore name a parent in a DIFFERENT tenant: invisible
-- to its own parent's organization scope while still hanging off that parent —
-- a leak and an orphan in the same row.
--
-- This was measured, not assumed. Before this migration, all FOURTEEN
-- relationships below accepted a cross-tenant child, and a report could be
-- re-parented onto another tenant's submission or handed to another
-- organization outright by a single UPDATE.
-- (`scripts/tenancy-adversarial-scenarios.mjs --expect-gap`.)
--
-- ── WHY IN SQL, AND WHY ALL OF THEM ────────────────────────────────────────
--
-- The Reference Architecture requires isolation "across every layer" (§7.22)
-- and that it "shall never be bypassed" (§11.8), while §7.22 also forbids
-- reimplementing a cross-cutting concern inconsistently per domain. Before
-- this, the invariant was enforced in exactly ONE place — the report
-- repository's parent check — and nowhere else. One guarded path out of
-- fourteen IS the inconsistency that rule names.
--
-- The repositories run as `service_role`, which BYPASSES RLS, so row-level
-- policies are not the layer that can close this. A composite foreign key is:
-- it is checked for every writer, including the migration engine and any
-- future route, and it cannot be forgotten by a new call site.
--
-- ── FORWARD-ONLY, AND NON-DESTRUCTIVE ──────────────────────────────────────
--
-- No column is added, dropped or retyped, and no row is written. Each parent
-- gains a UNIQUE (id, organization_id) — already true, since `id` is the
-- primary key, so it is satisfied by every existing row by construction. Each
-- child's single-column foreign key is then replaced by the two-column form
-- against it.
--
-- The migration VALIDATES BEFORE IT ALTERS. If historical data already
-- contains a cross-tenant child, the constraint would fail at creation with a
-- message naming only the constraint; the check below fails first and names the
-- table, the row and what is wrong with it, because an operator reading a
-- deployment failure needs to know which data to fix.
--
-- ── `ON DELETE SET NULL` NEEDED A COLUMN LIST ──────────────────────────────
--
-- Four of these are `SET NULL`. On a two-column key that would null BOTH
-- columns, and `organization_id` is NOT NULL — so a parent delete would fail
-- instead of orphaning the child, turning a tidy-up into an outage. PostgreSQL
-- 15+ takes a column list, so only the parent reference is cleared and the
-- tenant stays put.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Refuse to proceed on data that already violates the invariant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pair   RECORD;
  v_count  BIGINT;
  v_report TEXT := '';
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('contact_methods',     'contact_id',    'contacts'),
      ('leads',               'lead_source_id','lead_sources'),
      ('leads',               'contact_id',    'contacts'),
      ('lead_tags',           'lead_id',       'leads'),
      ('submissions',         'lead_id',       'leads'),
      ('submissions',         'contact_id',    'contacts'),
      ('submission_sections', 'submission_id', 'submissions'),
      ('diagnostic_answers',  'submission_id', 'submissions'),
      ('diagnostic_answers',  'section_id',    'submission_sections'),
      ('diagnostic_scores',   'submission_id', 'submissions'),
      ('domain_scores',       'submission_id', 'submissions'),
      ('reports',             'submission_id', 'submissions'),
      ('report_versions',     'report_id',     'reports'),
      ('outcomes',            'submission_id', 'submissions')
    ) AS t(child, column_name, parent)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c JOIN public.%I p ON p.id = c.%I
         WHERE c.organization_id IS DISTINCT FROM p.organization_id',
      v_pair.child, v_pair.parent, v_pair.column_name
    ) INTO v_count;
    IF v_count > 0 THEN
      v_report := v_report || format(
        E'\n  %s.%s -> %s: %s row(s) whose organization differs from their parent''s',
        v_pair.child, v_pair.column_name, v_pair.parent, v_count
      );
    END IF;
  END LOOP;

  IF v_report <> '' THEN
    RAISE EXCEPTION 'cortex_tenancy_composite_keys: existing rows already cross a tenant boundary.%',
      v_report
      USING HINT =
        'Fix or remove those rows before applying this migration. It will not '
        'silently reassign a row to another organization.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Each parent gains the two-column key the children will point at.
--    `id` is already the primary key, so this is true of every existing row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'contacts', 'lead_sources', 'leads', 'submissions', 'submission_sections', 'reports'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_table)::regclass
        AND conname  = format('%s_id_organization_uk', v_table)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, organization_id)',
        v_table, format('%s_id_organization_uk', v_table)
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Replace each single-column foreign key with the tenant-carrying form.
--    The ON DELETE behaviour of the original is preserved exactly; `SET NULL`
--    takes a column list so `organization_id` is never the thing nulled.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fk RECORD;
BEGIN
  FOR v_fk IN
    SELECT * FROM (VALUES
      ('contact_methods',     'contact_id',    'contacts',            'CASCADE'),
      ('leads',               'lead_source_id','lead_sources',        'SET NULL'),
      ('leads',               'contact_id',    'contacts',            'SET NULL'),
      ('lead_tags',           'lead_id',       'leads',               'CASCADE'),
      ('submissions',         'lead_id',       'leads',               'SET NULL'),
      ('submissions',         'contact_id',    'contacts',            'SET NULL'),
      ('submission_sections', 'submission_id', 'submissions',         'CASCADE'),
      ('diagnostic_answers',  'submission_id', 'submissions',         'CASCADE'),
      ('diagnostic_answers',  'section_id',    'submission_sections', 'SET NULL'),
      ('diagnostic_scores',   'submission_id', 'submissions',         'CASCADE'),
      ('domain_scores',       'submission_id', 'submissions',         'CASCADE'),
      ('reports',             'submission_id', 'submissions',         'CASCADE'),
      ('report_versions',     'report_id',     'reports',             'CASCADE'),
      ('outcomes',            'submission_id', 'submissions',         'CASCADE')
    ) AS t(child, column_name, parent, on_delete)
  LOOP
    -- The original, by its default name. Dropped only once the replacement is
    -- about to be created, and both happen inside this transaction.
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_fk.child, format('%s_%s_fkey', v_fk.child, v_fk.column_name)
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_fk.child)::regclass
        AND conname  = format('%s_%s_organization_fkey', v_fk.child, v_fk.column_name)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I
           FOREIGN KEY (%I, organization_id)
           REFERENCES public.%I (id, organization_id)
           ON DELETE %s',
        v_fk.child,
        format('%s_%s_organization_fkey', v_fk.child, v_fk.column_name),
        v_fk.column_name,
        v_fk.parent,
        CASE WHEN v_fk.on_delete = 'SET NULL'
             -- The column list is the whole point: without it the delete would
             -- try to null `organization_id` as well and fail on NOT NULL.
             THEN format('SET NULL (%I)', v_fk.column_name)
             ELSE v_fk.on_delete
        END
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE
    'cortex_tenancy_composite_keys: 14 parent-child relationships now carry the tenant in the key';
END $$;

COMMIT;
