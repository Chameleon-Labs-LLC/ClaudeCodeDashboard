# Issue #2 — CLAUDE.md discovery trust boundary

GitHub: https://github.com/lelandg/ClaudeCodeDashboard/issues/2

## Problem

`app/api/claude-md/route.ts` derived per-project filesystem roots by decoding the
`~/.claude/projects/<dir>` directory name (e.g. `-home-agent-code-Foo` → `/home/agent/code/Foo`)
and recursively walking the result. This had two consequences:

1. Overlapping encoded roots (`-home-agent`, `-home-agent-code`,
   `-home-agent-code-ChatMaster`) all decoded to real ancestors of one another, so the
   same `CLAUDE.md` files were discovered multiple times and attributed to whichever
   parent walked there first.
2. The decoded folder name was the only trust anchor — a crafted entry under
   `~/.claude/projects` could steer recursive scanning at unintended filesystem locations.

## Fix

New helper `lib/claude-project-roots.ts`:

- `getTrustedProjectRoots()` enumerates `~/.claude/projects/<dir>`, reads the first
  non-empty `cwd` field out of each session JSONL file as the canonical root, and only
  falls back to `decodeClaudeProjectPath` when no session data is available.
- Every candidate is canonicalized with `fs.realpath` and validated as a real directory.
- Results are deduped by canonical real path so overlapping encoded entries collapse.
- `resolveTrustedProjectRoot(encodedName)` is the safe lookup for the
  `?project=<encoded>` query path — it never trusts the encoded name on its own.
- `isPathWithin(parent, child)` lets callers prune subtrees that are themselves separate
  trusted roots.

`app/api/claude-md/route.ts` now:

- Uses `getTrustedProjectRoots()` instead of inline decoding.
- Walks each root with a `pruneRoots` set built from sibling roots, so a parent root
  (e.g. `/home/agent`) does not rediscover `CLAUDE.md` files inside child roots
  (e.g. `/home/agent/code/ClaudeCodeDashboard/CLAUDE.md`).
- Resolves each walked subdirectory through `fs.realpath` before recursing, so
  symlinked detours into another trusted root are also pruned.
- `?project=<encoded>` lookups go through `resolveTrustedProjectRoot`, which means an
  encoded name that isn't backed by a real Claude project returns 404 instead of being
  decoded into an arbitrary path.

## Verified

- `npx tsc --noEmit` clean.
- Smoke test against the local `~/.claude/projects` set: 6 trusted roots collapse to 4
  unique `CLAUDE.md` files (was previously rediscovering the child files via the
  `-home-agent` and `-home-agent-code` parent encodings).

## Not done

- Regression tests are listed in the issue's "fix direction" but the project has no
  test runner configured (`package.json` scripts: `dev`, `build`, `start`, `lint`,
  `typecheck` only). Adding Vitest + fixtures is a separate change.
- `lib/claude-data.ts` still uses `decodeClaudeProjectPath` inside `listProjects()` to
  produce a display path. That call is purely cosmetic — it does not drive any
  filesystem walk — so it was left alone.
