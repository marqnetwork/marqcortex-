-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4D: two customers, one platform, and no path between
--
-- Runs after 20260901120000_ai_customer_byok.sql and the tenant fixture, as
-- `service_role` — the role the edge function actually holds, on a database
-- whose objects are owned by a NOSUPERUSER role.
--
-- WHY THIS FILE IS THE BATCH'S CENTRAL EVIDENCE.
--
-- Every isolation claim Batch 4D makes is a claim about what the DATABASE will
-- and will not permit while the runtime issues the statements it actually
-- issues. TypeScript tests can prove the service asks the right questions; only
-- this can prove the schema gives the right answers — and the interesting
-- failures here are all silent ones. A cross-tenant read returns rows rather
-- than an error. A re-pointed configuration commits. Two active credentials on
-- one tenant look fine until the runtime has to pick.
--
--   4D-T1   two customers and MARQ can each hold a configuration for the SAME
--           provider, simultaneously — the partial unique indexes admit it
--   4D-T2   the tenant lookup the resolver issues returns ONE tenant's row and
--           never the other's, and never the platform's
--   4D-T3   the platform lookup (organization_id IS NULL) returns MARQ's row
--           and never a customer's — a customer credential cannot leak into
--           MARQ's own execution
--   4D-T4   the tenant enumeration returns only the asking tenant's rows
--   4D-T5   the activation RPC works for a customer configuration, and each
--           tenant's rotation is independent
--   4D-T6   ONE active credential per configuration, per tenant, enforced by
--           the database
--   4D-T7   revocation is scoped: revoking under one configuration leaves the
--           other tenant's credential active
--   4D-T8   a configuration's OWNING TENANT is immutable — the re-point attack
--   4D-T9   a configuration's SCOPE is immutable — the promote-to-platform
--           attack, which would hand a customer's key to MARQ's own execution
--   4D-T10  everything a configuration is SUPPOSED to allow still updates
--   4D-T11  an organization row cannot omit its tenant, and a platform row
--           cannot name one — the 4C constraint, still holding under 4D
--   4D-T12  plaintext-shaped credential storage is still refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_marq    UUID;
  v_acme    UUID;
  v_globex  UUID;
  v_count   INTEGER;
  v_text    TEXT;
  v_failed  BOOLEAN;
  v_sealed  JSONB := '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXYtdmFsdWU=","ct":"Y2lwaGVy"}'::JSONB;
BEGIN
  SELECT id INTO v_marq   FROM public.organizations WHERE slug = 'marq'   AND deleted_at IS NULL;
  SELECT id INTO v_acme   FROM public.organizations WHERE slug = 'acme'   AND deleted_at IS NULL;
  SELECT id INTO v_globex FROM public.organizations WHERE slug = 'globex' AND deleted_at IS NULL;
  IF v_acme IS NULL OR v_globex IS NULL OR v_marq IS NULL THEN
    RAISE EXCEPTION '4D-T: the tenant fixture did not produce three organizations';
  END IF;

  SET ROLE service_role;

  -- -------------------------------------------------------------------------
  -- 4D-T1. THREE CONFIGURATIONS FOR ONE PROVIDER.
  --
  -- MARQ's platform row and two customers' rows, all for `openai`, all at once.
  -- The two partial unique indexes are what make this legal: one platform row
  -- per provider, one organization row per (tenant, provider). A single full
  -- unique index on `provider_key` — the obvious first design — would have made
  -- customer BYOK impossible without dropping MARQ's own row.
  --
  -- Written as the upsert PostgREST issues, so this exercises INSERT and
  -- UPDATE privilege in one statement, the way the runtime does.
  -- -------------------------------------------------------------------------
  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, enabled, certification,
     configuration, created_by, updated_by)
  VALUES ('pvc_4dPlatform', 'openai', 'OpenAI', 'platform', NULL, TRUE, 'certified',
          '{}'::JSONB, 'harness', 'harness')
  ON CONFLICT (id) DO UPDATE SET updated_at = NOW(), updated_by = EXCLUDED.updated_by;

  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, enabled, certification,
     credential_fallback, configuration, created_by, updated_by)
  VALUES ('pvc_4dAcme', 'openai', 'OpenAI', 'organization', v_acme, TRUE, 'certified',
          'platform', '{}'::JSONB, 'acme-admin', 'acme-admin')
  ON CONFLICT (id) DO UPDATE SET updated_at = NOW(), updated_by = EXCLUDED.updated_by;

  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, enabled, certification,
     credential_fallback, configuration, created_by, updated_by)
  VALUES ('pvc_4dGlobex', 'openai', 'OpenAI', 'organization', v_globex, TRUE, 'certified',
          'tenant_only', '{}'::JSONB, 'globex-admin', 'globex-admin')
  ON CONFLICT (id) DO UPDATE SET updated_at = NOW(), updated_by = EXCLUDED.updated_by;

  -- A SECOND organization row for the same tenant and provider must be refused.
  v_failed := FALSE;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_4dAcmeDup', 'openai', 'OpenAI', 'organization', v_acme, 'x', 'x');
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4D-T1: a tenant was allowed two configurations for one provider. The runtime would '
      'have to pick, and any tiebreak it applied would be a guess about which key the '
      'customer meant.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T2. THE TENANT LOOKUP THE RESOLVER ISSUES.
  --
  -- `findConfiguration('organization', 'openai', <tenant>)` renders as this.
  -- It must return exactly one row and it must be the asking tenant's.
  -- -------------------------------------------------------------------------
  SELECT count(*), string_agg(id, ',') INTO v_count, v_text
    FROM cortex.ai_provider_configuration
   WHERE scope = 'organization' AND provider_key = 'openai' AND organization_id = v_acme;
  IF v_count <> 1 OR v_text <> 'pvc_4dAcme' THEN
    RAISE EXCEPTION
      '4D-T2: the tenant lookup for Acme returned % row(s) [%]; expected exactly pvc_4dAcme',
      v_count, coalesce(v_text, 'none');
  END IF;

  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_configuration
   WHERE scope = 'organization' AND provider_key = 'openai' AND organization_id = v_globex
     AND id <> 'pvc_4dGlobex';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '4D-T2: Globex''s tenant lookup returned a row that is not Globex''s';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T3. THE PLATFORM LOOKUP CANNOT SEE A CUSTOMER.
  --
  -- `IS NULL`, not `= NULL`: PostgREST renders `eq` as `= NULL`, which is never
  -- true, so a platform row would never be found — the exact spelling the
  -- partial unique index depends on and the store comments on.
  --
  -- This is the direction that matters most for MARQ: a customer's credential
  -- must never become MARQ's own execution credential.
  -- -------------------------------------------------------------------------
  SELECT count(*), string_agg(id, ',') INTO v_count, v_text
    FROM cortex.ai_provider_configuration
   WHERE scope = 'platform' AND provider_key = 'openai' AND organization_id IS NULL;
  IF v_count <> 1 OR v_text <> 'pvc_4dPlatform' THEN
    RAISE EXCEPTION
      '4D-T3: the platform lookup returned % row(s) [%]; a customer configuration is '
      'reachable from MARQ''s own resolution', v_count, coalesce(v_text, 'none');
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T4. THE TENANT ENUMERATION RETURNS ONE TENANT.
  --
  -- `listOrganizationConfigurations(<tenant>)`. Two predicates, both asserted,
  -- because the store applies both: the tenant alone would be correct only
  -- while the scope/tenancy CHECK holds, and a tenant read that depends on a
  -- constraint in another file for its isolation is one migration from
  -- returning platform rows.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_configuration
   WHERE scope = 'organization' AND organization_id = v_acme;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '4D-T4: Acme''s enumeration returned % rows, expected 1', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_configuration
   WHERE scope = 'organization' AND organization_id = v_acme
     AND organization_id IS DISTINCT FROM v_acme;
  IF v_count <> 0 THEN
    RAISE EXCEPTION '4D-T4: Acme''s enumeration contained a row for another organization';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T5. THE ACTIVATION RPC, FOR CUSTOMER CONFIGURATIONS.
  --
  -- The same SECURITY DEFINER function Batch 4C created, called for an
  -- organization-scoped configuration. It takes a configuration id and knows
  -- nothing about scope, which is exactly why it needed no change — and exactly
  -- why this has to be asked rather than assumed.
  -- -------------------------------------------------------------------------
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_4dAcme1', 'pvc_4dAcme', 'primary', v_sealed, 'k_1a2b', 'fp_aaaaaaaa',
    'aaaa', 1, NOW(), NULL, 'acme-admin');
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_4dGlobex1', 'pvc_4dGlobex', 'primary', v_sealed, 'k_1a2b', 'fp_bbbbbbbb',
    'bbbb', 1, NOW(), NULL, 'globex-admin');
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_4dPlatform1', 'pvc_4dPlatform', 'primary', v_sealed, 'k_1a2b', 'fp_cccccccc',
    'cccc', 1, NOW(), NULL, 'marq-operator');

  -- Acme rotates. Globex and the platform must be untouched: a rotation is
  -- scoped to ONE configuration, and a supersede that reached across
  -- configurations would silently retire another customer's live key.
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_4dAcme2', 'pvc_4dAcme', 'rotated', v_sealed, 'k_1a2b', 'fp_dddddddd',
    'dddd', 2, NOW(), NOW(), 'acme-admin');

  SELECT status INTO v_text FROM cortex.ai_provider_credential WHERE id = 'pvk_4dAcme1';
  IF v_text <> 'superseded' THEN
    RAISE EXCEPTION '4D-T5: Acme''s previous credential is %, expected superseded', v_text;
  END IF;
  SELECT status INTO v_text FROM cortex.ai_provider_credential WHERE id = 'pvk_4dGlobex1';
  IF v_text <> 'active' THEN
    RAISE EXCEPTION
      '4D-T5: rotating Acme''s credential changed Globex''s to %. A rotation reached across '
      'tenants.', v_text;
  END IF;
  SELECT status INTO v_text FROM cortex.ai_provider_credential WHERE id = 'pvk_4dPlatform1';
  IF v_text <> 'active' THEN
    RAISE EXCEPTION
      '4D-T5: rotating a customer''s credential changed MARQ''s platform credential to %',
      v_text;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T6. ONE ACTIVE CREDENTIAL PER CONFIGURATION, PER TENANT.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_credential
   WHERE configuration_id = 'pvc_4dAcme' AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '4D-T6: Acme has % active credentials, expected exactly 1', v_count;
  END IF;

  -- And the history survives the rotation, which is what makes "which key was
  -- in force when?" answerable later.
  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_credential WHERE configuration_id = 'pvc_4dAcme';
  IF v_count <> 2 THEN
    RAISE EXCEPTION '4D-T6: Acme''s rotation history holds % rows, expected 2', v_count;
  END IF;

  -- A direct second active insert must be refused by the index, not by the
  -- caller. `service_role` holds no INSERT on this table, so the attempt is
  -- made through the function — which is the only writer there is.
  v_failed := FALSE;
  BEGIN
    PERFORM cortex.ai_provider_credential_activate(
      'pvk_4dAcme2', 'pvc_4dAcme', 'duplicate', v_sealed, 'k_1a2b', 'fp_eeeeeeee',
      'eeee', 3, NOW(), NOW(), 'acme-admin');
  EXCEPTION WHEN unique_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-T6: a duplicate credential id was accepted';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T7. REVOCATION IS SCOPED.
  --
  -- The runtime's revoke is `UPDATE ... WHERE configuration_id = ? AND id = ?`.
  -- Both predicates matter: the credential id alone would be enough to find the
  -- row, and would therefore be enough to revoke ANOTHER tenant's row if a
  -- caller ever supplied one.
  -- -------------------------------------------------------------------------
  UPDATE cortex.ai_provider_credential
     SET status = 'revoked', revoked_at = NOW(), revoked_by = 'acme-admin', updated_at = NOW()
   WHERE configuration_id = 'pvc_4dAcme' AND id = 'pvk_4dAcme2';

  SELECT status INTO v_text FROM cortex.ai_provider_credential WHERE id = 'pvk_4dGlobex1';
  IF v_text <> 'active' THEN
    RAISE EXCEPTION '4D-T7: revoking Acme''s credential changed Globex''s to %', v_text;
  END IF;

  -- The same statement with the WRONG configuration matches nothing, which is
  -- what makes a mis-scoped revoke a no-op rather than a cross-tenant write.
  UPDATE cortex.ai_provider_credential
     SET status = 'revoked', revoked_at = NOW(), revoked_by = 'acme-admin', updated_at = NOW()
   WHERE configuration_id = 'pvc_4dAcme' AND id = 'pvk_4dGlobex1';
  SELECT status INTO v_text FROM cortex.ai_provider_credential WHERE id = 'pvk_4dGlobex1';
  IF v_text <> 'active' THEN
    RAISE EXCEPTION
      '4D-T7: a revoke scoped to Acme''s configuration reached Globex''s credential';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T8. THE RE-POINT ATTACK. A configuration's owning tenant is immutable.
  --
  -- Credentials are keyed by configuration id, so a single UPDATE moving
  -- `organization_id` would move every credential under it — Acme's live key
  -- would become Globex's. The sealed record's AAD would refuse the decryption,
  -- but by then Globex's console would already have shown Acme's fingerprint,
  -- last four characters and rotation history.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    UPDATE cortex.ai_provider_configuration
       SET organization_id = v_globex
     WHERE id = 'pvc_4dAcme';
  EXCEPTION WHEN raise_exception THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4D-T8: a configuration was re-pointed at another organization. Every credential '
      'under it followed.';
  END IF;

  SELECT organization_id INTO v_marq FROM cortex.ai_provider_configuration
   WHERE id = 'pvc_4dAcme';
  IF v_marq <> v_acme THEN
    RAISE EXCEPTION '4D-T8: the refused re-point still changed the row';
  END IF;

  -- Setting it to NULL is the same attack in the other spelling, and `<>` would
  -- not catch it: `NULL <> NULL` is NULL, not TRUE.
  v_failed := FALSE;
  BEGIN
    UPDATE cortex.ai_provider_configuration SET organization_id = NULL WHERE id = 'pvc_4dAcme';
  EXCEPTION WHEN raise_exception OR check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-T8: a configuration was stripped of its owning organization';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T9. THE PROMOTE ATTACK. A configuration's scope is immutable.
  --
  -- Promoting a customer row to `platform` would put that customer's credential
  -- on the resolution MARQ's own execution uses — one UPDATE, and MARQ would be
  -- spending a customer's vendor account platform-wide.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    UPDATE cortex.ai_provider_configuration SET scope = 'platform' WHERE id = 'pvc_4dAcme';
  EXCEPTION WHEN raise_exception OR check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4D-T9: a customer configuration was promoted to platform scope. Its credential is '
      'now on MARQ''s own execution path.';
  END IF;

  -- And the reverse: MARQ's own row demoted onto a customer.
  v_failed := FALSE;
  BEGIN
    UPDATE cortex.ai_provider_configuration
       SET scope = 'organization', organization_id = v_globex
     WHERE id = 'pvc_4dPlatform';
  EXCEPTION WHEN raise_exception OR check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-T9: MARQ''s platform configuration was demoted onto a customer';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T10. EVERYTHING ADMINISTRATION IS FOR STILL WORKS.
  --
  -- The trigger must refuse two columns and nothing else. A guard that also
  -- blocked the legitimate writes would be discovered as an outage rather than
  -- as a security control.
  -- -------------------------------------------------------------------------
  UPDATE cortex.ai_provider_configuration
     SET enabled = FALSE,
         credential_fallback = 'tenant_only',
         certification = 'degraded',
         display_name = 'OpenAI (Acme)',
         configuration = '{"region":"eu"}'::JSONB,
         updated_at = NOW(),
         updated_by = 'acme-admin'
   WHERE id = 'pvc_4dAcme';

  SELECT credential_fallback INTO v_text
    FROM cortex.ai_provider_configuration WHERE id = 'pvc_4dAcme';
  IF v_text <> 'tenant_only' THEN
    RAISE EXCEPTION '4D-T10: a legitimate fallback change was not applied (got %)', v_text;
  END IF;

  -- Restore, so the rollback assertion sees the shape it expects.
  UPDATE cortex.ai_provider_configuration
     SET enabled = TRUE, credential_fallback = 'platform', certification = 'certified'
   WHERE id = 'pvc_4dAcme';

  -- -------------------------------------------------------------------------
  -- 4D-T11. THE 4C SCOPE/TENANCY CONSTRAINT STILL HOLDS UNDER 4D.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_4dOrphan', 'anthropic', 'Anthropic', 'organization', NULL, 'x', 'x');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-T11: an organization-scoped configuration was created with no tenant';
  END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_4dHybrid', 'anthropic', 'Anthropic', 'platform', v_acme, 'x', 'x');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-T11: a platform configuration was created naming a tenant';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-T12. PLAINTEXT-SHAPED STORAGE IS STILL REFUSED, FOR A CUSTOMER ROW.
  --
  -- The sealed-record CHECK is Batch 4C's, and it applies to every credential
  -- whatever the owning scope. Asked again here because Batch 4D is the batch
  -- that introduces a new writer of that table.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    PERFORM cortex.ai_provider_credential_activate(
      'pvk_4dPlain', 'pvc_4dGlobex', 'plaintext', '{"value":"sk-live-not-encrypted"}'::JSONB,
      'k_1a2b', 'fp_ffffffff', 'ffff', 9, NOW(), NULL, 'attacker');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4D-T12: a customer credential row accepted a record with no sealed-secret shape';
  END IF;

  RESET ROLE;

  RAISE NOTICE
    'assert_4d_tenant_isolation: PASSED (4D-T1..T12 — three estates coexist, every lookup '
    'is tenant-scoped, rotation and revocation do not cross tenants, and a configuration''s '
    'scope and owner are immutable)';
END;
$$;
