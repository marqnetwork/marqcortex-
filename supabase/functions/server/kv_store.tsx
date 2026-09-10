/* Originally scaffolded by Figma Make. No generator in this repository
   reproduces it, so it is maintained by hand from here on. */

/* Table schema:
CREATE TABLE kv_store_324f4fbe (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);
*/

// View at https://supabase.com/dashboard/project/oqybniefkbppptfatoae/database/tables

// This file provides a simple key-value interface for storing Figma Make data. It should be adequate for most small-scale use cases.
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

/**
 * A deployment variable this store cannot run without.
 *
 * `Deno.env.get` returns `string | undefined`, and both values were handed
 * straight to `createClient`, which is typed `string`. Absent, they already
 * failed — supabase-js throws "supabaseUrl is required." — but only on the
 * first KV call, and without naming WHICH variable the deployment is missing.
 *
 * The failure is unchanged: missing configuration still throws, and this
 * still refuses to build a client without it. What changes is that the throw
 * names the variable. The VALUE is never logged or included — the second of
 * these is the service-role key.
 */
const requireEnv = (name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`kv_store: ${name} is not set in this deployment's environment.`);
  }
  return value;
};

const client = () => createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

// Set stores a key-value pair in the database.
export const set = async (key: string, value: any): Promise<void> => {
  const supabase = client()
  const { error } = await supabase.from("kv_store_324f4fbe").upsert({
    key,
    value
  });
  if (error) {
    throw new Error(error.message);
  }
};

// Get retrieves a key-value pair from the database.
export const get = async (key: string): Promise<any> => {
  const supabase = client()
  const { data, error } = await supabase.from("kv_store_324f4fbe").select("value").eq("key", key).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.value;
};

// Delete deletes a key-value pair from the database.
export const del = async (key: string): Promise<void> => {
  const supabase = client()
  const { error } = await supabase.from("kv_store_324f4fbe").delete().eq("key", key);
  if (error) {
    throw new Error(error.message);
  }
};

// Sets multiple key-value pairs in the database.
export const mset = async (keys: string[], values: any[]): Promise<void> => {
  const supabase = client()
  const { error } = await supabase.from("kv_store_324f4fbe").upsert(keys.map((k, i) => ({ key: k, value: values[i] })));
  if (error) {
    throw new Error(error.message);
  }
};

// Gets multiple key-value pairs from the database.
export const mget = async (keys: string[]): Promise<any[]> => {
  const supabase = client()
  const { data, error } = await supabase.from("kv_store_324f4fbe").select("value").in("key", keys);
  if (error) {
    throw new Error(error.message);
  }
  return data?.map((d) => d.value) ?? [];
};

// Deletes multiple key-value pairs from the database.
export const mdel = async (keys: string[]): Promise<void> => {
  const supabase = client()
  const { error } = await supabase.from("kv_store_324f4fbe").delete().in("key", keys);
  if (error) {
    throw new Error(error.message);
  }
};

// Search for key-value pairs by prefix.
export const getByPrefix = async (prefix: string): Promise<any[]> => {
  const supabase = client()
  const { data, error } = await supabase.from("kv_store_324f4fbe").select("key, value").like("key", prefix + "%");
  if (error) {
    throw new Error(error.message);
  }
  return data?.map((d) => d.value) ?? [];
};