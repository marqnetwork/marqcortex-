import { getProviderHealth, listProviders } from './providerRegistry.ts';

export function checkAllProviderHealth() {
  return listProviders().map((p) => getProviderHealth(p.providerId));
}
