# Multi-Machine `.claude` Usage Sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register additional `.claude` folders (e.g. WSL's, via `\\wsl.localhost\...`) and aggregate token/cost usage across all of them in the Usage page, with a per-source filter and a new Sources management tab.

**Architecture:** A `sources.json` registry in `~/.claude/ccd/` managed by `lib/usage-sources.ts`; `lib/usage-engine.ts` gains source tagging and a multi-root loader with global dedup; `/api/sources` CRUD routes; a new `/dashboard/sources` page; Usage page gains a `sources` filter, By Source breakdown, and an unreachable-source banner.

**Tech Stack:** Next.js 14 App Router, TypeScript, node:test (`tests/lib/`, run via `npx tsx --test <file>`), existing ChameleonLabs Tailwind theme.

**Spec:** `Docs/plans/2026-06-12-multi-source-usage-design.md`

**Conventions that apply to every task:**
- Never read the filesystem from client components — all fs work in `lib/` + API routes.
- After code changes, `npx tsc --noEmit` must pass before committing.
- Run from repo root `/mnt/d/Documents/Code/GitHub/ClaudeCodeDashboard`; use absolute paths, no `cd`.

---

### Task 1: Source registry — `lib/usage-sources.ts`

**Files:**
- Create: `lib/usage-sources.ts`
- Test: `tests/lib/usage-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/usage-sources.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadSources,
  saveSources,
  slugId,
  collectStats,
  validateSourcePath,
  type UsageSource,
} from '../../lib/usage-sources';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-sources-'));
}

/** Make a fake .claude root with a projects dir and one transcript. */
function fakeRoot(dir: string): string {
  const proj = path.join(dir, 'projects', 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), '{}\n');
  return dir;
}

test('loadSources: missing file -> empty list', () => {
  const file = path.join(tmp(), 'sources.json');
  assert.deepEqual(loadSources(file), []);
});

test('loadSources: malformed file -> empty list', () => {
  const file = path.join(tmp(), 'sources.json');
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(loadSources(file), []);
});

test('saveSources/loadSources round-trip', () => {
  const file = path.join(tmp(), 'nested', 'sources.json');
  const sources: UsageSource[] = [
    { id: 'wsl', label: 'WSL Ubuntu', path: '/some/root', enabled: true },
  ];
  saveSources(sources, file);
  assert.deepEqual(loadSources(file), sources);
});

test('slugId: slugs the label and de-dupes against existing ids', () => {
  assert.equal(slugId('WSL Ubuntu', []), 'wsl-ubuntu');
  const existing = [{ id: 'wsl-ubuntu', label: '', path: '', enabled: true }];
  assert.equal(slugId('WSL Ubuntu', existing), 'wsl-ubuntu-2');
  assert.equal(slugId('!!!', []), 'source');
});

test('collectStats: counts projects, transcripts, latest mtime', () => {
  const root = fakeRoot(tmp());
  const stats = collectStats(root);
  assert.equal(stats.projectCount, 1);
  assert.equal(stats.transcriptCount, 1);
  assert.ok(stats.latestActivity); // ISO string
});

test('validateSourcePath: ok for a real root', () => {
  const root = fakeRoot(tmp());
  const res = validateSourcePath(root, [], '/nonexistent-primary');
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.stats.projectCount, 1);
});

test('validateSourcePath: rejects missing dir', () => {
  const res = validateSourcePath(path.join(tmp(), 'nope'), [], '/x');
  assert.deepEqual(res, { ok: false, reason: 'path does not exist or is not a directory' });
});

test('validateSourcePath: rejects dir without projects/', () => {
  const res = validateSourcePath(tmp(), [], '/x');
  assert.deepEqual(res, { ok: false, reason: 'no projects/ directory found — is this a .claude folder?' });
});

test('validateSourcePath: rejects the primary CLAUDE_HOME', () => {
  const root = fakeRoot(tmp());
  const res = validateSourcePath(root, [], root);
  assert.deepEqual(res, { ok: false, reason: 'this is the primary .claude folder (already included)' });
});

test('validateSourcePath: rejects an already-registered path', () => {
  const root = fakeRoot(tmp());
  const existing = [{ id: 'a', label: 'A', path: root, enabled: true }];
  const res = validateSourcePath(root, existing, '/x');
  assert.deepEqual(res, { ok: false, reason: 'this folder is already registered' });
});

test('validateSourcePath: expands ~ to the home dir', () => {
  // "~" itself exists but has no projects/ dir in CI tmp homes is not guaranteed;
  // assert only that expansion happens (no "does not exist" for "~").
  const res = validateSourcePath('~', [], '/x');
  if (!res.ok) assert.notEqual(res.reason, 'path does not exist or is not a directory');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/lib/usage-sources.test.ts`
Expected: FAIL — `Cannot find module '../../lib/usage-sources'`

- [ ] **Step 3: Implement `lib/usage-sources.ts`**

```ts
/**
 * Registry of additional .claude roots ("sources") aggregated into usage.
 * Persisted at ~/.claude/ccd/sources.json. The primary CLAUDE_HOME is NEVER
 * stored here — it is always the implicit source "local" / "This machine".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClaudeHome } from './claude-home';

export interface UsageSource {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
}

export interface SourceStats {
  projectCount: number;
  transcriptCount: number;
  /** ISO timestamp of the newest transcript, or null when none found */
  latestActivity: string | null;
}

export type SourceValidation =
  | { ok: true; stats: SourceStats }
  | { ok: false; reason: string };

export const PRIMARY_SOURCE_ID = 'local';
export const PRIMARY_SOURCE_LABEL = 'This machine';

export function getSourcesPath(): string {
  return path.join(getClaudeHome(), 'ccd', 'sources.json');
}

export function loadSources(filePath: string = getSourcesPath()): UsageSource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { sources?: unknown };
    if (!Array.isArray(raw.sources)) return [];
    return raw.sources.filter(
      (s): s is UsageSource =>
        !!s &&
        typeof (s as UsageSource).id === 'string' &&
        typeof (s as UsageSource).label === 'string' &&
        typeof (s as UsageSource).path === 'string' &&
        typeof (s as UsageSource).enabled === 'boolean',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('usage-sources: could not read', filePath, err);
    }
    return [];
  }
}

export function saveSources(sources: UsageSource[], filePath: string = getSourcesPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ sources }, null, 2));
}

export function slugId(label: string, existing: UsageSource[]): string {
  const base =
    label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
  const taken = new Set(existing.map((s) => s.id));
  if (!taken.has(base) && base !== PRIMARY_SOURCE_ID) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function expandTilde(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function collectStats(root: string): SourceStats {
  const projectsDir = path.join(root, 'projects');
  let projectCount = 0;
  let transcriptCount = 0;
  let latestMtime = 0;
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return { projectCount: 0, transcriptCount: 0, latestActivity: null };
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    projectCount++;
    const projectDir = path.join(projectsDir, d.name);
    let files: string[];
    try {
      files = fs
        .readdirSync(projectDir, { recursive: true, encoding: 'utf-8' })
        .filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    transcriptCount += files.length;
    for (const rel of files) {
      try {
        const m = fs.statSync(path.join(projectDir, rel)).mtimeMs;
        if (m > latestMtime) latestMtime = m;
      } catch {
        /* file vanished mid-scan */
      }
    }
  }
  return {
    projectCount,
    transcriptCount,
    latestActivity: latestMtime ? new Date(latestMtime).toISOString() : null,
  };
}

export function validateSourcePath(
  candidate: string,
  existing: UsageSource[],
  primaryHome: string = getClaudeHome(),
): SourceValidation {
  const resolved = path.resolve(expandTilde(candidate.trim()));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: 'path does not exist or is not a directory' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: 'path does not exist or is not a directory' };
  }
  if (resolved === path.resolve(primaryHome)) {
    return { ok: false, reason: 'this is the primary .claude folder (already included)' };
  }
  if (existing.some((s) => path.resolve(expandTilde(s.path)) === resolved)) {
    return { ok: false, reason: 'this folder is already registered' };
  }
  let hasProjects = false;
  try {
    hasProjects = fs.statSync(path.join(resolved, 'projects')).isDirectory();
  } catch {
    /* fallthrough */
  }
  if (!hasProjects) {
    return { ok: false, reason: 'no projects/ directory found — is this a .claude folder?' };
  }
  return { ok: true, stats: collectStats(resolved) };
}

/** Resolve a source's root to an absolute path (with ~ expansion). */
export function resolveSourceRoot(source: UsageSource): string {
  return path.resolve(expandTilde(source.path));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/lib/usage-sources.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/usage-sources.ts tests/lib/usage-sources.test.ts
git commit -m "feat(usage): add .claude source registry with validation"
```

---

### Task 2: Engine — tag entries with their source

**Files:**
- Modify: `lib/usage-engine.ts` (interface `UsageEntry`, `parseUsageFile`, `loadUsageEntries`)
- Modify: `tests/lib/usage-engine.test.ts` (the `entry()` factory at line ~42)

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/usage-engine.test.ts`:

```ts
test('parseUsageFile tags entries with the given source label', () => {
  const out = parseUsageFile(line(), 'sess-1', 'proj-a', 'WSL Ubuntu');
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'WSL Ubuntu');
});

test('parseUsageFile defaults source to "This machine"', () => {
  const out = parseUsageFile(line(), 'sess-1', 'proj-a');
  assert.equal(out[0].source, 'This machine');
});
```

And add `source: 'This machine',` to the `entry()` factory object (after `projectName: 'proj-a',`).

- [ ] **Step 2: Run tests to verify failure**

Run: `npx tsx --test tests/lib/usage-engine.test.ts`
Expected: FAIL — `source` does not exist / is undefined

- [ ] **Step 3: Implement**

In `lib/usage-engine.ts`:

1. Import the label constant (top of file, with the other imports):
```ts
import { PRIMARY_SOURCE_LABEL } from './usage-sources';
```
2. Add to `interface UsageEntry` (after `projectName: string;`):
```ts
  /** which .claude root this entry came from (source label) */
  source: string;
```
3. Change `parseUsageFile` signature and the pushed object:
```ts
export function parseUsageFile(
  content: string,
  sessionId: string,
  projectName: string,
  source: string = PRIMARY_SOURCE_LABEL,
): UsageEntry[] {
```
and inside `out.push({ ... })` add `source,` after `projectName,`.

4. Change `loadUsageEntries` signature and thread the label through to `parseUsageFile`:
```ts
export function loadUsageEntries(
  projectsDir: string = getProjectsDir(),
  source: string = PRIMARY_SOURCE_LABEL,
): LoadResult {
```
and in the `parseUsageFile(...)` call inside it, pass `source` as the 4th argument.

Note: the per-file `fileCache` is keyed by absolute file path, which is unique per root, so cached entries always carry the right source.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/lib/usage-engine.test.ts`
Expected: all PASS (including pre-existing tests — the factory got `source` added)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/usage-engine.ts tests/lib/usage-engine.test.ts
git commit -m "feat(usage): tag usage entries with their source root"
```

---

### Task 3: Engine — multi-root loader with global dedup

**Files:**
- Modify: `lib/usage-engine.ts` (extend `LoadResult`, add `loadAllUsageEntries`)
- Test: `tests/lib/usage-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/usage-engine.test.ts` (it already imports `fs`, `os`, `path`):

```ts
import { loadAllUsageEntries } from '../../lib/usage-engine';
import { saveSources } from '../../lib/usage-sources';

/** Build a fake .claude root containing one transcript line. */
function fakeClaudeRoot(jsonl: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-root-'));
  const proj = path.join(root, 'projects', 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), jsonl + '\n');
  return root;
}

test('loadAllUsageEntries merges roots, tags sources, skips unreachable', () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  // second root gets a DISTINCT message (msg-2/req-2) so it survives global dedup
  const wsl = fakeClaudeRoot(
    line({ requestId: 'req-2' }).replace('"msg-1"', '"msg-2"'),
  );
  const sourcesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-cfg-')), 'sources.json');
  saveSources(
    [
      { id: 'wsl', label: 'WSL Ubuntu', path: wsl, enabled: true },
      { id: 'gone', label: 'Old Laptop', path: path.join(os.tmpdir(), 'ccd-nope-xyz'), enabled: true },
      { id: 'off', label: 'Disabled', path: wsl, enabled: false },
    ],
    sourcesFile,
  );
  const result = loadAllUsageEntries({
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
  });
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    result.entries.map((e) => e.source).sort(),
    ['This machine', 'WSL Ubuntu'],
  );
  assert.deepEqual(result.unreachableSources, ['Old Laptop']);
});

test('loadAllUsageEntries dedups identical messages across roots', () => {
  clearUsageFileCache();
  const primary = fakeClaudeRoot(line());
  const copy = fakeClaudeRoot(line()); // same messageId/requestId — a copied folder
  const sourcesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-cfg-')), 'sources.json');
  saveSources([{ id: 'copy', label: 'Copy', path: copy, enabled: true }], sourcesFile);
  const result = loadAllUsageEntries({
    primaryProjectsDir: path.join(primary, 'projects'),
    sourcesFile,
  });
  assert.equal(result.entries.length, 1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx tsx --test tests/lib/usage-engine.test.ts`
Expected: FAIL — `loadAllUsageEntries` not exported

- [ ] **Step 3: Implement**

In `lib/usage-engine.ts`:

1. Extend imports from `./usage-sources`:
```ts
import { PRIMARY_SOURCE_LABEL, loadSources, resolveSourceRoot, getSourcesPath } from './usage-sources';
```
2. Extend `LoadResult`:
```ts
export interface LoadResult {
  entries: UsageEntry[];
  /** entry count before deduplication */
  rawEntryCount: number;
  /** labels of enabled sources whose projects dir could not be read */
  unreachableSources: string[];
}
```
3. `loadUsageEntries` returns include `unreachableSources: []` (both return statements; the early-return error path returns `unreachableSources: [PRIMARY_SOURCE_LABEL]` — wait, no: the early return means the *primary* dir was unreadable, but `loadUsageEntries` is also used per-root. Return `unreachableSources: []` in both places and let the caller decide reachability — see step 4.)

Concretely: change `return { entries: [], rawEntryCount: 0 };` to `return { entries: [], rawEntryCount: 0, unreachableSources: [] };` and the final return to `return { entries, rawEntryCount: all.length, unreachableSources: [] };`

4. Add the multi-root loader:
```ts
export interface LoadAllOptions {
  /** test override; defaults to the primary CLAUDE_HOME projects dir */
  primaryProjectsDir?: string;
  /** test override; defaults to ~/.claude/ccd/sources.json */
  sourcesFile?: string;
}

/** Load usage entries from the primary root plus every enabled registered source. */
export function loadAllUsageEntries(opts: LoadAllOptions = {}): LoadResult {
  const all: UsageEntry[] = [];
  let rawEntryCount = 0;
  const unreachableSources: string[] = [];

  const primary = loadUsageEntries(opts.primaryProjectsDir ?? getProjectsDir());
  all.push(...primary.entries);
  rawEntryCount += primary.rawEntryCount;

  for (const source of loadSources(opts.sourcesFile ?? getSourcesPath())) {
    if (!source.enabled) continue;
    const projectsDir = path.join(resolveSourceRoot(source), 'projects');
    let reachable = false;
    try {
      reachable = fs.statSync(projectsDir).isDirectory();
    } catch {
      /* unreachable */
    }
    if (!reachable) {
      unreachableSources.push(source.label);
      continue;
    }
    const result = loadUsageEntries(projectsDir, source.label);
    all.push(...result.entries);
    rawEntryCount += result.rawEntryCount;
  }

  // global dedup: a copied/rsynced root must not double-count
  return { entries: dedupeEntries(all), rawEntryCount, unreachableSources };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/lib/usage-engine.test.ts`
Expected: all PASS

- [ ] **Step 5: Type-check, run full suite, commit**

```bash
npx tsc --noEmit
npm test
git add lib/usage-engine.ts tests/lib/usage-engine.test.ts
git commit -m "feat(usage): multi-root usage loading with cross-root dedup"
```

(`npm test` will surface any other `LoadResult` literal that needs the new field — `tests/lib/usage-engine.test.ts:148` builds one inline; add `unreachableSources: []` to it.)

---

### Task 4: Engine — report: source filter, By Source totals, meta

**Files:**
- Modify: `lib/usage-engine.ts` (`UsageReportOptions`, `UsageReport`, `buildUsageReport`)
- Test: `tests/lib/usage-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/usage-engine.test.ts`:

```ts
test('buildUsageReport: source filter, bySource totals, meta fields', () => {
  const pricing = { map: buildPricingMap({}), source: 'fallback' as const };
  const load = {
    entries: [
      entry(),
      entry({ messageId: 'msg-9', requestId: 'req-9', source: 'WSL Ubuntu', outputTokens: 50 }),
    ],
    rawEntryCount: 2,
    unreachableSources: ['Old Laptop'],
  };
  const all = buildUsageReport(load, pricing);
  assert.deepEqual(all.meta.allSources, ['This machine', 'WSL Ubuntu']);
  assert.deepEqual(all.meta.unreachableSources, ['Old Laptop']);
  assert.equal(all.bySource['WSL Ubuntu'].outputTokens, 50);
  assert.equal(all.bySource['This machine'].outputTokens, 5);

  const filtered = buildUsageReport(load, pricing, { sources: ['WSL Ubuntu'] });
  assert.equal(filtered.totals.outputTokens, 50);
  // unfiltered option lists still expose every source
  assert.deepEqual(filtered.meta.allSources, ['This machine', 'WSL Ubuntu']);
});
```

(Match the pricing-map construction used by the existing `buildUsageReport` tests in this file — if they build `pricing` differently, copy that idiom instead of the literal above.)

- [ ] **Step 2: Run test to verify failure**

Run: `npx tsx --test tests/lib/usage-engine.test.ts`
Expected: FAIL — `bySource`/`allSources` undefined

- [ ] **Step 3: Implement**

In `lib/usage-engine.ts`:

1. `UsageReportOptions` — add:
```ts
  /** source labels; matches UsageEntry.source */
  sources?: string[];
```
2. `UsageReport` — add `bySource: Record<string, TokenBreakdown>;` after `byProject`, and in `meta` add:
```ts
    allSources: string[];
    unreachableSources: string[];
```
3. In `buildUsageReport`:
   - declare alongside the other accumulators: `const allSources = new Set<string>();` and `const bySource: Record<string, TokenBreakdown> = {};`
   - in the entry loop, after `allProjects.add(e.projectName);`: `allSources.add(e.source);`
   - with the other filters: `if (opts.sources?.length && !opts.sources.includes(e.source)) continue;`
   - after `addTo((byProject[e.projectName] ??= emptyBreakdown()), e, cost);`: `addTo((bySource[e.source] ??= emptyBreakdown()), e, cost);`
   - in the returned object: `bySource,` and in `meta`: `allSources: [...allSources].sort(), unreachableSources: load.unreachableSources,`

- [ ] **Step 4: Run tests, type-check, commit**

```bash
npx tsx --test tests/lib/usage-engine.test.ts   # all PASS
npx tsc --noEmit
git add lib/usage-engine.ts tests/lib/usage-engine.test.ts
git commit -m "feat(usage): per-source report breakdown and filter"
```

---

### Task 5: API — `/api/sources` CRUD

**Files:**
- Create: `app/api/sources/route.ts`
- Create: `app/api/sources/[id]/route.ts`

No route-level tests (project has none for simple fs-backed routes; logic is covered by Task 1 unit tests). Manual verification at the end of the task.

- [ ] **Step 1: Create `app/api/sources/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getClaudeHome } from '@/lib/claude-home';
import {
  PRIMARY_SOURCE_ID,
  PRIMARY_SOURCE_LABEL,
  collectStats,
  loadSources,
  resolveSourceRoot,
  saveSources,
  slugId,
  validateSourcePath,
  type SourceStats,
  type UsageSource,
} from '@/lib/usage-sources';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export interface SourceView extends UsageSource {
  implicit: boolean;
  reachable: boolean;
  stats: SourceStats;
}

function withStats(source: UsageSource, implicit: boolean): SourceView {
  const root = resolveSourceRoot(source);
  let reachable = false;
  try {
    reachable = fs.statSync(path.join(root, 'projects')).isDirectory();
  } catch {
    /* unreachable */
  }
  return {
    ...source,
    implicit,
    reachable,
    stats: reachable
      ? collectStats(root)
      : { projectCount: 0, transcriptCount: 0, latestActivity: null },
  };
}

export async function GET() {
  try {
    const primary: UsageSource = {
      id: PRIMARY_SOURCE_ID,
      label: PRIMARY_SOURCE_LABEL,
      path: getClaudeHome(),
      enabled: true,
    };
    const sources = [withStats(primary, true), ...loadSources().map((s) => withStats(s, false))];
    return NextResponse.json({ sources });
  } catch (err) {
    console.error('GET /api/sources failed:', err);
    return NextResponse.json({ error: 'failed to list sources' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { label?: string; path?: string };
    const label = body.label?.trim();
    const sourcePath = body.path?.trim();
    if (!label || !sourcePath) {
      return NextResponse.json({ error: 'label and path are required' }, { status: 400 });
    }
    const existing = loadSources();
    const validation = validateSourcePath(sourcePath, existing);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }
    const source: UsageSource = {
      id: slugId(label, existing),
      label,
      path: sourcePath,
      enabled: true,
    };
    saveSources([...existing, source]);
    return NextResponse.json({ source: withStats(source, false) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/sources failed:', err);
    return NextResponse.json({ error: 'failed to add source' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `app/api/sources/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { PRIMARY_SOURCE_ID, loadSources, saveSources } from '@/lib/usage-sources';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    if (params.id === PRIMARY_SOURCE_ID) {
      return NextResponse.json({ error: 'the primary source cannot be modified' }, { status: 400 });
    }
    const body = (await request.json()) as { label?: string; enabled?: boolean };
    const sources = loadSources();
    const source = sources.find((s) => s.id === params.id);
    if (!source) return NextResponse.json({ error: 'source not found' }, { status: 404 });
    if (typeof body.label === 'string' && body.label.trim()) source.label = body.label.trim();
    if (typeof body.enabled === 'boolean') source.enabled = body.enabled;
    saveSources(sources);
    return NextResponse.json({ source });
  } catch (err) {
    console.error('PATCH /api/sources/[id] failed:', err);
    return NextResponse.json({ error: 'failed to update source' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    if (params.id === PRIMARY_SOURCE_ID) {
      return NextResponse.json({ error: 'the primary source cannot be removed' }, { status: 400 });
    }
    const sources = loadSources();
    if (!sources.some((s) => s.id === params.id)) {
      return NextResponse.json({ error: 'source not found' }, { status: 404 });
    }
    saveSources(sources.filter((s) => s.id !== params.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/sources/[id] failed:', err);
    return NextResponse.json({ error: 'failed to remove source' }, { status: 500 });
  }
}
```

(Match the `params` typing used by existing `[id]` routes, e.g. `app/api/inbox/[id]/read/route.ts` — if that file awaits `params` as a Promise, copy that idiom.)

- [ ] **Step 3: Type-check, manual smoke, commit**

```bash
npx tsc --noEmit
```
Then with the dev server running (user runs it from PowerShell; if needed, verify via `npm run build` instead of live curl):
```bash
curl -s http://localhost:3000/api/sources | head -c 400   # expect {"sources":[{"id":"local",...
```
```bash
git add app/api/sources/
git commit -m "feat(usage): /api/sources CRUD routes"
```

---

### Task 6: API — wire `/api/usage` to multi-root loading

**Files:**
- Modify: `app/api/usage/route.ts`

- [ ] **Step 1: Implement**

In `app/api/usage/route.ts`:
1. Change the engine import to `buildUsageReport, loadAllUsageEntries, type Granularity`.
2. Replace `loadUsageEntries()` with `loadAllUsageEntries()` in the `GET` handler.
3. Add to the options object passed to `buildUsageReport`:
```ts
      sources: listParam(searchParams, 'sources'),
```

- [ ] **Step 2: Type-check, commit**

```bash
npx tsc --noEmit
git add app/api/usage/route.ts
git commit -m "feat(usage): aggregate all registered sources in /api/usage"
```

---

### Task 7: UI — Sources page + sidebar entry

**Files:**
- Modify: `components/layout/sidebar.tsx` (navItems array)
- Create: `app/dashboard/sources/page.tsx`

- [ ] **Step 1: Add the nav item**

In `components/layout/sidebar.tsx`, insert after the Usage & Cost line (`{ href: '/dashboard/usage', ... }`):
```ts
  { href: '/dashboard/sources', label: 'Sources', icon: '⛁' },
```

- [ ] **Step 2: Create `app/dashboard/sources/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface SourceStats {
  projectCount: number;
  transcriptCount: number;
  latestActivity: string | null;
}

interface SourceView {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
  implicit: boolean;
  reachable: boolean;
  stats: SourceStats;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add form
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<SourceView | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/sources')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSources(data.sources);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  async function addSource() {
    setAdding(true);
    setAddError(null);
    setAdded(null);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setAdded(data.source);
      setLabel('');
      setPath('');
      refresh();
    } catch (err) {
      setAddError(String(err));
    } finally {
      setAdding(false);
    }
  }

  async function rename(s: SourceView) {
    const next = prompt('New label:', s.label)?.trim();
    if (!next || next === s.label) return;
    await fetch(`/api/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: next }),
    });
    refresh();
  }

  async function toggle(s: SourceView) {
    await fetch(`/api/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    refresh();
  }

  async function remove(s: SourceView) {
    if (!confirm(`Remove source "${s.label}"? Usage from it will disappear from the dashboard.`)) return;
    await fetch(`/api/sources/${s.id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="p-8 max-w-5xl">
      <h2 className="font-heading text-2xl text-brand-cyan mb-2">Data Sources</h2>
      <p className="text-gray-400 text-sm mb-6">
        Additional <code className="text-brand-cyan">.claude</code> folders aggregated into Usage &amp; Cost.
        The primary folder is always included.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Source table */}
      <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs border-b border-brand-navy-light/30">
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3 text-right">Projects</th>
              <th className="px-4 py-3 text-right">Transcripts</th>
              <th className="px-4 py-3">Latest activity</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((s) => (
              <tr key={s.id} className="border-b border-brand-navy-light/20 last:border-0">
                <td className="px-4 py-3">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-2 ${
                      s.reachable ? 'bg-chameleon-green' : 'bg-red-500'
                    }`}
                    title={s.reachable ? 'reachable' : 'unreachable'}
                  />
                  <span className={s.enabled ? 'text-white' : 'text-gray-500 line-through'}>
                    {s.label}
                  </span>
                  {s.implicit && <span className="ml-2 text-xs text-gray-500">(primary)</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs break-all">{s.path}</td>
                <td className="px-4 py-3 text-right text-gray-300">{s.stats.projectCount}</td>
                <td className="px-4 py-3 text-right text-gray-300">{s.stats.transcriptCount}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {s.stats.latestActivity ? new Date(s.stats.latestActivity).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {!s.implicit && (
                    <>
                      <button
                        onClick={() => rename(s)}
                        className="text-xs text-gray-400 hover:text-brand-cyan mr-3"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => toggle(s)}
                        className="text-xs text-gray-400 hover:text-brand-cyan mr-3"
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="text-xs text-gray-400 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {sources === null && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-xl p-5 mb-6">
        <h3 className="text-white font-semibold mb-3">Add a .claude folder</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-gray-400">
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="WSL Ubuntu"
              className="block mt-1 bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-3 py-2 text-sm text-gray-200 w-44"
            />
          </label>
          <label className="text-xs text-gray-400 flex-1 min-w-72">
            Path to the .claude folder
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="\\wsl.localhost\Ubuntu\home\leland\.claude"
              className="block mt-1 w-full bg-brand-navy-light border border-brand-navy-light/50 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono"
            />
          </label>
          <button
            onClick={addSource}
            disabled={adding || !label.trim() || !path.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-brand-cyan/20 border border-brand-cyan/50 text-brand-cyan hover:bg-brand-cyan/30 disabled:opacity-40"
          >
            {adding ? 'Validating…' : 'Validate & Add'}
          </button>
        </div>
        {addError && <p className="text-red-400 text-sm mt-3">{addError}</p>}
        {added && (
          <p className="text-chameleon-green text-sm mt-3">
            Added “{added.label}”: {added.stats.projectCount} projects, {added.stats.transcriptCount}{' '}
            transcripts
            {added.stats.latestActivity &&
              `, latest ${new Date(added.stats.latestActivity).toLocaleString()}`}
            .
          </p>
        )}
      </div>

      {/* Hints */}
      <div className="bg-brand-navy-light/30 border border-brand-navy-light/30 rounded-xl p-5 text-sm text-gray-400 space-y-2">
        <h3 className="text-white font-semibold">Common locations</h3>
        <p>
          <span className="text-gray-300">WSL from Windows:</span>{' '}
          <code className="text-brand-cyan">\\wsl.localhost\&lt;distro&gt;\home\&lt;user&gt;\.claude</code>
        </p>
        <p>
          <span className="text-gray-300">Windows from WSL:</span>{' '}
          <code className="text-brand-cyan">/mnt/c/Users/&lt;user&gt;/.claude</code>
        </p>
        <p>
          Other machines work too as long as the folder is mounted/reachable as a path (network drive,
          SSHFS, synced copy — duplicates are deduplicated automatically).
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check, commit**

```bash
npx tsc --noEmit
git add components/layout/sidebar.tsx app/dashboard/sources/page.tsx
git commit -m "feat(usage): Sources tab for managing additional .claude roots"
```

---

### Task 8: UI — Usage page source filter, By Source section, banner

**Files:**
- Modify: `app/dashboard/usage/page.tsx`

- [ ] **Step 1: Implement**

1. Type updates — in the local `UsageReport` interface: add `bySource: Record<string, TokenBreakdown>;` after `byProject` (line ~31) and in `meta` add `allSources: string[]; unreachableSources: string[];` (after `allProjects`, line ~38).
2. State (after `const [models, setModels] = useState<string[]>([]);`, line ~132):
```ts
  const [sources, setSources] = useState<string[]>([]);
```
3. Query (in the `useMemo` at line ~141): after the `models` line add
```ts
    if (sources.length) p.set('sources', sources.join(','));
```
and add `sources` to the dependency array.
4. Filter control (after the Models `MultiSelect`, line ~291) — only show when there is more than one source:
```tsx
        {report.meta.allSources.length > 1 && (
          <MultiSelect label="Sources" options={report.meta.allSources} selected={sources} onChange={setSources} />
        )}
```
5. Unreachable banner — directly above the stat-cards `div` (line ~324):
```tsx
      {report.meta.unreachableSources.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm mb-4">
          Totals exclude {report.meta.unreachableSources.length} unreachable source
          {report.meta.unreachableSources.length > 1 ? 's' : ''}:{' '}
          {report.meta.unreachableSources.join(', ')} — check the Sources tab.
        </div>
      )}
```
6. By Source section — after the By Model grid's closing `</div>` (line ~404), same card idiom as By Model, only rendered with 2+ sources:
```tsx
      {Object.keys(report.bySource).length > 1 && (
        <>
          <h3 className="text-lg text-white font-semibold mb-4">By Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {Object.entries(report.bySource)
              .sort(([, a], [, b]) => b.cost - a.cost)
              .map(([source, data]) => (
                <div
                  key={source}
                  className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4 hover:border-brand-cyan/20 transition-colors"
                >
                  <p className="text-brand-cyan text-sm font-medium mb-2">{source}</p>
                  <div className="space-y-1 text-xs">
                    <p className="text-gray-400">
                      Input: <span className="text-white">{fmt(data.inputTokens)}</span> &middot; Output:{' '}
                      <span className="text-white">{fmt(data.outputTokens)}</span>
                    </p>
                    <p className="text-gray-400">
                      Cache write: <span className="text-white">{fmt(data.cacheCreationTokens)}</span> &middot; read:{' '}
                      <span className="text-white">{fmt(data.cacheReadTokens)}</span>
                    </p>
                    <p className="text-gray-400">
                      Cost: <span className="text-chameleon-green">{fmtCost(data.cost)}</span>
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
```

- [ ] **Step 2: Type-check, commit**

```bash
npx tsc --noEmit
git add app/dashboard/usage/page.tsx
git commit -m "feat(usage): source filter and per-source breakdown on Usage page"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full test suite + build**

```bash
npm test          # all node:test suites pass
npm run build     # Next.js production build succeeds
```

- [ ] **Step 2: Manual end-to-end (user-assisted)**

With the dev server running on Windows: open `/dashboard/sources`, add label `WSL Ubuntu` path `\\wsl.localhost\Ubuntu\home\leland\.claude`, confirm validation stats appear, then open `/dashboard/usage` and confirm the Sources filter + By Source section show both machines and totals increase.

- [ ] **Step 3: Completion report**

Write a summary md to `Docs/` per global conventions (what shipped, files, how to add a source) and commit any remaining changes.
