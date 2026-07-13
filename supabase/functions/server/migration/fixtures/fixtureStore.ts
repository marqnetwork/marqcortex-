/**
 * Insert/delete S6.3 disposable KV fixtures — service role only
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { KV_TABLE } from '../config.ts';
import { S6VALIDATE_FIXTURES } from './s6validate.ts';
import { throwOnError } from '../client.ts';

export async function countFixtureKeys(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from(KV_TABLE)
    .select('key', { count: 'exact', head: true })
    .or('key.like.lead:s6validate:%,key.like.lead_email:s6validate:%');
  throwOnError(error, 'countFixtureKeys');
  return count ?? 0;
}

export async function assertNoFixtureKeys(client: SupabaseClient): Promise<void> {
  const count = await countFixtureKeys(client);
  if (count > 0) {
    throw new Error(`Refusing to insert fixtures: ${count} s6validate keys already exist`);
  }
}

export async function insertS6ValidateFixtures(client: SupabaseClient): Promise<string[]> {
  await assertNoFixtureKeys(client);

  const keys: string[] = [];
  for (const fixture of S6VALIDATE_FIXTURES) {
    const { data: existing } = await client.from(KV_TABLE).select('key').eq('key', fixture.key).maybeSingle();
    if (existing) {
      throw new Error(`Fixture key already exists: ${fixture.key}`);
    }
    const { error } = await client.from(KV_TABLE).insert({ key: fixture.key, value: fixture.value });
    throwOnError(error, `insertFixture.${fixture.key}`);
    keys.push(fixture.key);
  }
  return keys;
}

export async function deleteS6ValidateFixtures(client: SupabaseClient): Promise<number> {
  const keys = S6VALIDATE_FIXTURES.map((f) => f.key);
  const { error, count } = await client.from(KV_TABLE).delete({ count: 'exact' }).in('key', keys);
  throwOnError(error, 'deleteS6ValidateFixtures');
  return count ?? 0;
}
