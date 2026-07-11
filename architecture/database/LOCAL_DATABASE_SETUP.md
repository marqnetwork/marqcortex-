# Local Supabase Database Setup

**Sprint:** MCV2-S4-IMPLEMENT-001

## Overview

Tenancy foundation migrations live in `supabase/migrations/`. They are **additive** and do not modify `kv_store_324f4fbe`.

## Quick start (when Supabase CLI is available)

```bash
supabase init   # once, if config missing
supabase start
supabase db reset
npm run test:database
psql "$DATABASE_URL" -f tests/database/tenancy_schema.test.sql
```

## Manual psql apply

```bash
psql "$STAGING_DATABASE_URL" \
  -f supabase/migrations/20260711050000_cortex_tenancy_foundation.sql
psql "$STAGING_DATABASE_URL" \
  -f supabase/migrations/20260711050001_cortex_tenancy_rls_and_seed.sql
```

## Rollback

```bash
psql "$DATABASE_URL" -f supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
```

## Production

**Not authorized this sprint.** Migrations are staged for review only.

## Membership bootstrap

See `architecture/database/MEMBERSHIP_BOOTSTRAP.md`.
