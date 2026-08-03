-- Atomic compare-and-swap for the key-value store.
--
-- WHY THIS EXISTS.
--
-- AI operational settings are one shared record that several Supabase Edge
-- isolates may write. Optimistic concurrency over a read-then-write pair leaves
-- a time-of-check-to-time-of-use window: two isolates can both read version N,
-- both find their precondition satisfied, and both write N+1 — losing one
-- change and putting two different configurations under one version number.
-- For the record that carries the AI kill switch, the lost change can be the
-- kill switch itself, and nothing detects it afterwards because the version
-- numbers agree.
--
-- A conditional UPDATE closes it. The comparison and the write are one
-- statement, so PostgreSQL's row lock does the arbitration: of two concurrent
-- writers at the same expected version, exactly one updates a row and the other
-- updates none.
--
-- THE DOUBLE-ENCODING.
--
-- `kv_store_324f4fbe.value` is JSONB, but the server's key-value helper stores
-- `JSON.stringify(value)`, so a record is usually a JSONB *string* containing
-- JSON rather than a JSONB object. `kv_json` normalises both shapes so the
-- version can be read either way, and so this function keeps working if the
-- writer is ever changed to store objects directly.

-- Normalise a possibly double-encoded JSONB value to its object form.
create or replace function public.kv_json(p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_value is null then null
    when jsonb_typeof(p_value) = 'string' then
      -- A stored JSON string. Parse it; a value that is not valid JSON yields
      -- null rather than raising, so a corrupt row cannot break a comparison.
      (case
         when (p_value #>> '{}') ~ '^\s*[\{\[]' then (p_value #>> '{}')::jsonb
         else null
       end)
    else p_value
  end;
$$;

comment on function public.kv_json(jsonb) is
  'Normalise a kv_store value that may be a JSONB object or a JSONB string containing JSON.';

-- Compare-and-swap a key-value record on its `configurationVersion`.
--
-- `p_expected_version = 0` means "there must be no record yet"; the insert is
-- made atomic by the primary key via ON CONFLICT DO NOTHING.
--
-- Returns true when the write happened, false when the precondition did not
-- hold. A false return is a lost race, not an error — the caller re-reads,
-- re-applies its change and retries.
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

  -- Conditional update. One statement, arbitrated by the row lock: of two
  -- concurrent writers at the same expected version, exactly one matches.
  update public.kv_store_324f4fbe
     set value = p_value
   where key = p_key
     and (public.kv_json(value) ->> 'configurationVersion')::integer = p_expected_version;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.kv_compare_and_swap(text, integer, jsonb) is
  'Atomic compare-and-swap on a kv_store record keyed by its configurationVersion. Returns true when the write happened.';

-- The Edge function calls this with the service role.
revoke all on function public.kv_compare_and_swap(text, integer, jsonb) from public;
grant execute on function public.kv_compare_and_swap(text, integer, jsonb) to service_role;
revoke all on function public.kv_json(jsonb) from public;
grant execute on function public.kv_json(jsonb) to service_role;
