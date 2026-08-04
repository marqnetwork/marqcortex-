-- Atomic compare-and-swap on a caller-named version field.
--
-- WHY THIS EXISTS.
--
-- `kv_compare_and_swap` (20260803120000, corrected by 20260803130000) arbitrates
-- concurrent writers for ONE record — the AI operational settings — and it hard-
-- codes the field it compares, `configurationVersion`, because that record is
-- the only thing it was ever meant to guard.
--
-- The AI-01 Batch 3A agent runtime needs the same guarantee for records that
-- are neither one nor settings: every agent run, every approval and every
-- checkpoint. A run advances from more than one isolate, and a read-then-write
-- pair leaves a time-of-check-to-time-of-use window in which two isolates each
-- take "the next step" of the same run — duplicated model calls, duplicated
-- spend, and a step history that says one thing happened twice.
--
-- Two ways to close that were available and only one is honest:
--
--   Reuse `kv_compare_and_swap` by naming a run's version `configurationVersion`.
--   That puts a permanently misleading field on every agent record, and it
--   couples two unrelated record types to one function, so the next change to
--   either has to be safe for both.
--
--   Take the field name as an argument. The comparison stays one statement, the
--   old function is untouched, and each record type keeps a version field named
--   after what it versions.
--
-- This migration is additive. `kv_compare_and_swap` and `kv_json` are not
-- redefined, not dropped and not called differently; an environment that has
-- applied only the earlier migrations behaves exactly as before.
--
-- THE VERSION TEST IS TOTAL.
--
-- Copied deliberately from the corrective migration's `CASE`, and for the same
-- reason: `(value ->> 'field')::integer` RAISES on anything that is not an
-- integer literal, so a hand-edited or corrupted row would make every future
-- write to that key fail permanently rather than returning an ordinary lost
-- race. `CASE` is defined to evaluate its branches in order, so the type test
-- provably runs before the cast — unlike an `AND` conjunct, which the planner
-- may reorder. `::numeric` rather than `::integer` in the taken branch, so a
-- fractional stored version compares unequal instead of raising.
--
-- THE FIELD NAME IS AN IDENTIFIER, NOT SQL.
--
-- It is used only as a jsonb key through the `->` and `->>` operators, which
-- take a text argument — there is no dynamic SQL anywhere in this function, so
-- a hostile field name is a key that does not exist rather than an injection.
-- It is nonetheless bounded and pattern-checked, because a function that will
-- be called from application code should refuse an argument it cannot make
-- sense of instead of silently matching nothing.

create or replace function public.kv_compare_and_swap_field(
  p_key text,
  p_version_field text,
  p_expected_version integer,
  p_value jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_expected_version is null then
    raise exception 'kv_compare_and_swap_field requires an expected version';
  end if;

  if p_version_field is null or p_version_field !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' then
    raise exception 'kv_compare_and_swap_field requires a simple version field name';
  end if;

  if p_expected_version = 0 then
    -- Claim the key only if nobody else has. One statement, arbitrated by the
    -- primary key. This is also how an immutable record (a checkpoint) is
    -- written: "insert if absent" and nothing else.
    insert into public.kv_store_324f4fbe (key, value)
    values (p_key, p_value)
    on conflict (key) do nothing;
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;

  -- Conditional update. ONE statement, so the comparison and the write are
  -- atomic and two concurrent writers at the same expected version are
  -- arbitrated by the row lock: exactly one updates a row.
  update public.kv_store_324f4fbe
     set value = p_value
   where key = p_key
     and case
           when jsonb_typeof(public.kv_json(value) -> p_version_field) = 'number'
             then (public.kv_json(value) ->> p_version_field)::numeric = p_expected_version
           else false
         end;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.kv_compare_and_swap_field(text, text, integer, jsonb) is
  'Atomic compare-and-swap on a kv_store record keyed by a caller-named integer version field. Expected version 0 means insert-if-absent. Returns true when the write happened, false when the precondition did not hold — including when the stored version is missing or malformed.';

-- The Edge function calls this with the service role, exactly as it does the
-- single-record variant.
revoke all on function public.kv_compare_and_swap_field(text, text, integer, jsonb) from public;
grant execute on function public.kv_compare_and_swap_field(text, text, integer, jsonb) to service_role;
