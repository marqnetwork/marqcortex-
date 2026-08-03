-- Corrective migration for `kv_compare_and_swap`.
--
-- Supersedes the function body introduced in 20260803120000. That migration is
-- left exactly as it was: it has already gone out through preview builds and may
-- have been applied elsewhere, and rewriting an applied migration makes two
-- environments disagree about what "20260803120000" means. A corrective
-- migration is additive, so history stays true and every environment converges
-- on the same final definition regardless of which point it started from.
--
-- WHAT WAS WRONG.
--
-- The version comparison cast the stored value straight to integer:
--
--     (kv_json(value) ->> 'configurationVersion')::integer = p_expected_version
--
-- `->>` yields text, and casting text to integer RAISES on anything that is not
-- an integer literal. Executed against a real PostgreSQL 16 the original
-- function therefore threw, rather than returning false, for two of five
-- malformed shapes:
--
--     {"configurationVersion":"seven"}  ERROR: invalid input syntax ... "seven"
--     {"configurationVersion":6.5}      ERROR: invalid input syntax ... "6.5"
--
-- Everything else already degraded correctly — a non-JSON string, a missing
-- version and a null version all returned false, because `kv_json` guards its
-- own parse and `->>` on an absent key yields NULL.
--
-- WHY IT MATTERS. The settings writer only ever emits an integer, so normal
-- operation cannot produce such a record. A hand-edited row, a corrupted value
-- or a future revision can. The failure is safe — the adapter surfaces
-- INTERNAL_ERROR and nothing is applied, so persist-before-apply still holds —
-- but every settings write would fail permanently until the row was repaired by
-- hand, including the write that releases a kill switch. The store's own
-- contract is that a stored record degrades field by field rather than failing,
-- and `load()` already honours it: `parseStoredSettings` floors a malformed
-- version. So the platform would happily READ such a record and then be unable
-- to WRITE. This closes that asymmetry.
--
-- WHY `CASE` AND NOT AN `AND` GUARD.
--
-- The obvious repair is a type test in front of the cast:
--
--     AND jsonb_typeof(...) = 'number' AND (...)::integer = p_expected_version
--
-- That is not reliable. PostgreSQL does not guarantee left-to-right evaluation
-- of `AND` conjuncts — the planner may reorder them by estimated cost and reach
-- the cast first, which is exactly the failure being fixed, reintroduced
-- non-deterministically. `CASE` is defined to evaluate its branches in order and
-- to skip the arms it does not take, so the type test provably runs first.
--
-- `::numeric` rather than `::integer` in the taken branch: a JSON number may be
-- fractional, and 6.5 should compare unequal to 6 rather than raise.
--
-- `kv_json` is NOT replaced. Its regex-guarded parse was verified to return
-- false rather than raise for every malformed input tested, so it needs no
-- correction and is left alone.

create or replace function public.kv_compare_and_swap(
  p_key text,
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
    raise exception 'kv_compare_and_swap requires an expected version';
  end if;

  if p_expected_version = 0 then
    -- Claim the key only if nobody else has. One statement, arbitrated by the
    -- primary key.
    insert into public.kv_store_324f4fbe (key, value)
    values (p_key, p_value)
    on conflict (key) do nothing;
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;

  -- Conditional update. Still ONE statement, so the comparison and the write
  -- remain atomic and two concurrent writers at the same expected version are
  -- arbitrated by the row lock: exactly one updates a row.
  --
  -- The CASE makes the version test total. A record whose version is a string,
  -- a fraction, null, absent, or unparseable simply does not match, and the
  -- caller sees an ordinary lost race instead of an exception.
  update public.kv_store_324f4fbe
     set value = p_value
   where key = p_key
     and case
           when jsonb_typeof(public.kv_json(value) -> 'configurationVersion') = 'number'
             then (public.kv_json(value) ->> 'configurationVersion')::numeric = p_expected_version
           else false
         end;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.kv_compare_and_swap(text, integer, jsonb) is
  'Atomic compare-and-swap on a kv_store record keyed by its configurationVersion. Returns true when the write happened, false when the precondition did not hold — including when the stored version is malformed.';

-- Re-stated so an environment that applies only this migration ends up with the
-- same grants as one that applied both.
revoke all on function public.kv_compare_and_swap(text, integer, jsonb) from public;
grant execute on function public.kv_compare_and_swap(text, integer, jsonb) to service_role;
