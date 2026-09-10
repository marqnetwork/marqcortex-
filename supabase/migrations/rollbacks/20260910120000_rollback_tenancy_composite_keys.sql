-- ---------------------------------------------------------------------------
-- ROLLBACK — G2 (20260910120000_cortex_tenancy_composite_keys)
--
-- Restores the fourteen single-column foreign keys the forward migration
-- replaced, and drops the six two-column unique keys they no longer need. It
-- touches NO row: the forward migration wrote none, so the reverse has none to
-- put back.
--
-- ── WHAT ROLLING THIS BACK COSTS, PLAINLY ──────────────────────────────────
--
-- The tenancy invariant returns to being enforced NOWHERE in the database. A
-- child row will again be able to name a parent in another organization —
-- invisible to its own parent's organization scope while still hanging off that
-- parent — across all fourteen relationships. That was the state before the
-- forward migration, and `scripts/tenancy-adversarial-scenarios.mjs
-- --expect-gap` is what proves it was real rather than theoretical.
--
-- The application layer is unaffected and still refuses what it always refused:
-- every repository filters by `organization_id`, `resolveOrganization` admits
-- an organization hint only against a verified membership, and
-- `createReportVersion` still checks its parent. Rolling back does not open a
-- route; it removes the layer that catches a writer those guards do not cover —
-- the migration engine, a direct `service_role` statement, or a route not yet
-- written.
--
-- So this is a rollback for a DEPLOYMENT problem (a constraint that refuses
-- data an operator did not expect it to refuse), not a way to make unexpected
-- data acceptable. If it is run, the cross-tenant rows it re-permits should be
-- found and fixed before the forward migration is applied again — which is
-- exactly what the forward migration's own pre-flight check will insist on.
--
-- ── ORDERING ───────────────────────────────────────────────────────────────
--
-- Roll this back BEFORE 20260714050000_rollback_diagnostic, never after: that
-- one drops the tables these constraints live on, and dropping a table takes
-- its constraints with it, so running this second would find nothing.
--
-- Idempotent. Every drop is `IF EXISTS` and every add is guarded, so a partial
-- run can be repeated.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Put the single-column foreign keys back, with their original names and
--    their original ON DELETE behaviour.
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
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_fk.child, format('%s_%s_organization_fkey', v_fk.child, v_fk.column_name)
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_fk.child)::regclass
        AND conname  = format('%s_%s_fkey', v_fk.child, v_fk.column_name)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I
           FOREIGN KEY (%I) REFERENCES public.%I (id) ON DELETE %s',
        v_fk.child,
        format('%s_%s_fkey', v_fk.child, v_fk.column_name),
        v_fk.column_name,
        v_fk.parent,
        -- No column list here, and none is needed: a single-column SET NULL
        -- nulls only that column, which is where this started.
        v_fk.on_delete
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the two-column unique keys. Only after the foreign keys that
--    depended on them are gone — step 1 removed those.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'contacts', 'lead_sources', 'leads', 'submissions', 'submission_sections', 'reports'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_table, format('%s_id_organization_uk', v_table)
    );
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE
    'rollback_tenancy_composite_keys: the tenant is out of the key again on 14 relationships';
END $$;

COMMIT;
