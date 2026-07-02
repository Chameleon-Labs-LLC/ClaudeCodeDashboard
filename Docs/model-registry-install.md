# Model Registry Install

**Date:** 2026-06-10 13:23
**Skill:** `/model-registry install`

The project now resolves Claude model IDs from the published ChameleonLabs model
registry at runtime instead of hardcoding IDs that go stale.

## What was added

| File | Purpose |
|------|---------|
| `lib/model-registry.ts` | Vendored zero-dependency TypeScript client from [Chameleon-Labs-LLC/model-registry-client](https://github.com/Chameleon-Labs-LLC/model-registry-client) |
| `lib/model-registry.fallback.json` | Last-known-good registry snapshot (schema v2, fetched 2026-06-09) — bundled fallback so resolution never throws offline |
| `lib/models.ts` | Central resolution module: `modelRegistry` client (fallback wired), async `resolveModelId(provider, family)`, sync `fallbackModel(provider, family)` |

## What was changed

- **`lib/dispatcher.ts`** — `resolveModel()` is now async; the hardcoded
  `'claude-sonnet-4-6'` default was replaced with
  `await resolveModelId('anthropic', 'sonnet')`. Precedence is unchanged:
  `task.model` → `MISSION_CONTROL_DEFAULT_MODEL` env var → registry resolution.
- **`lib/skill-router.ts`** — stale `claude-3-haiku-20240307` reference in the
  stub comment now points to `resolveModelId('anthropic', 'haiku')`.
- **`package.json`** — new script `npm run models:refresh` re-snapshots the
  fallback (`/model-registry refresh-fallback` does the same).

Test fixtures (`tests/`, `__tests__/`) intentionally keep their literal model
IDs — they are test data, not runtime defaults.

## Failure ladder

Live registry fetch (5s timeout, 1h in-memory cache) → expired cache →
bundled fallback. With the fallback wired, `resolveModelId` never throws.
`MODEL_REGISTRY_URL` env var overrides the registry URL.

## Maintenance

This is a local-only tool with no CI, so the fallback refresh is manual:
run `npm run models:refresh` occasionally (the registry itself refreshes
daily at ~3 AM). `/model-registry status` reports staleness and drift.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint` on all touched files — clean
- Functional check (Node 24 type-stripping): live resolve returned
  `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`; with an unreachable
  registry URL the client logged the failure and served the fallback.
- `npm test` (tsx suite) cannot run from WSL — pre-existing issue:
  `node_modules` holds `@esbuild/win32-x64` (installed from Windows).
  Run the suite from PowerShell.
