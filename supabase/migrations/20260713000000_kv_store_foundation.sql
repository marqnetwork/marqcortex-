-- KV store used by the edge function (Figma Make legacy table name preserved)
CREATE TABLE IF NOT EXISTS public.kv_store_324f4fbe (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);

ALTER TABLE public.kv_store_324f4fbe ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; anon/authenticated have no direct access
COMMENT ON TABLE public.kv_store_324f4fbe IS
  'Key-value store for MARQ Cortex edge function. Access via service role only.';
