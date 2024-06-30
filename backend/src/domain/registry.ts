import { SourceProvider } from './provider';
import { notFound } from '../lib/httpError';

const providers = new Map<string, SourceProvider>();

/** Adds a provider to the registry. Called once per provider at boot. */
export const registerProvider = (provider: SourceProvider): void => {
  providers.set(provider.id.toLowerCase(), provider);
};

/** Looks up a provider, or throws a 404 for an id nobody registered. */
export const getProvider = (id: string): SourceProvider => {
  const provider = providers.get(id.toLowerCase());
  if (!provider) {
    throw notFound(`Unknown provider: ${id}`);
  }
  return provider;
};

export const hasProvider = (id: string): boolean => providers.has(id.toLowerCase());

export const listProviders = (): SourceProvider[] => Array.from(providers.values());

/** Test helper: empties the registry between cases. */
export const resetProviders = (): void => providers.clear();
