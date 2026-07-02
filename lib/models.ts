/**
 * Central model-ID resolution for the dashboard.
 *
 * Resolves current LLM model IDs from the ChameleonLabs model registry instead of
 * hardcoding IDs that go stale. The bundled fallback snapshot
 * (`model-registry.fallback.json`) makes resolution never-throw: live registry ->
 * in-memory cache -> bundled fallback.
 *
 * Refresh the fallback with `npm run models:refresh` (or `/model-registry refresh-fallback`).
 */
import { createRegistryClient, type ModelRegistry } from './model-registry';
import fallbackJson from './model-registry.fallback.json';

const fallback = fallbackJson as unknown as ModelRegistry;

export const modelRegistry = createRegistryClient({ fallback });

/** Sync last-known-good model ID from the bundled fallback (for import-time defaults). */
export function fallbackModel(provider: string, family: string): string {
  const id = fallback.families[provider]?.[family];
  if (!id) throw new Error(`no ${provider}/${family} in bundled model-registry fallback`);
  return id;
}

/** Current model ID for (provider, family) — live when reachable, fallback otherwise. */
export function resolveModelId(provider: string, family: string): Promise<string> {
  return modelRegistry.resolve(provider, family);
}
