/**
 * Startup warm-up for the usage parse cache (lib/usage-engine.ts).
 *
 * Kicked off from instrumentation.ts so the first /api/usage request doesn't
 * pay the full JSONL parse. Lives in its own module (not inline in
 * instrumentation.ts) because Node APIs there trip Turbopack's Edge-runtime
 * static analysis even behind a NEXT_RUNTIME guard.
 */
import { loadAllUsageEntries } from './usage-engine';
import { getDb } from './db';
import { getPricingMap } from './litellm-pricing';

export function warmUsageCache(): void {
  // pricing is memoized for an hour; get its network round-trip going now
  void getPricingMap();
  setImmediate(() => {
    try {
      const started = Date.now();
      const { entries } = loadAllUsageEntries({ db: getDb() });
      console.log(`usage cache warmed: ${entries.length} entries in ${Date.now() - started}ms`);
    } catch (err) {
      console.error('usage cache warm failed:', err);
    }
  });
}
