# Context-Sensitive Help System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `?` button on every dashboard page opens `/help/<topic>` for that page — a help-mode twin of the UI with a mirrored, amber-skinned sidebar, markdown topics for all 15 nav pages, prev/next paging, and close-returns-to-origin.

**Architecture:** Help routes live in `app/help/` (outside `app/dashboard/layout.tsx`) with their own chrome. The nav definition moves to a shared `components/layout/nav-items.ts` consumed by both sidebars so they cannot drift. Topics are markdown files in `content/help/` parsed by a server-side loader (`lib/help-content.ts`) and rendered with the already-installed `react-markdown`.

**Tech Stack:** Next.js 16 App Router (params is a `Promise` in server pages), TypeScript, Tailwind (brand tokens incl. `chameleon-amber`), `gray-matter`, `react-markdown` + `remark-gfm`, `node:test` via `npm test` (tsx runner).

**Spec:** `Docs/plans/2026-07-08-help-system-design.md` (approved 2026-07-08).

## Global Constraints

- **No new dependencies.** Everything needed (`gray-matter`, `react-markdown`, `remark-gfm`, `@tailwindcss/typography`) is already installed.
- **Tests:** `node:test` + `node:assert/strict` in `tests/lib/`, run with `npm test`. Do NOT use vitest (that's reserved for OTel tests in `__tests__/`).
- **Pre-commit gate for every task:** `npx tsc --noEmit` must pass before each commit.
- **Help accent color:** `chameleon-amber` (`#FFC107`, already in `tailwind.config.ts`). Main-UI accent stays `brand-cyan`.
- **Import alias:** use `@/` (e.g. `@/components/layout/nav-items`).
- **sessionStorage key for return-to-origin:** exactly `help-return-to`.
- **Topic slugs (canonical order = sidebar order):** `overview`, `sessions`, `memory`, `projects`, `history`, `activity`, `usage`, `sources`, `tools`, `observability`, `claude-md`, `settings`, `file-history`, `tasks`, `search`.
- Never `cd`; run all commands from the repo root with absolute or repo-relative paths.

---

### Task 1: Shared nav definition + pathname→topic mapper

**Files:**
- Create: `components/layout/nav-items.ts`
- Modify: `components/layout/sidebar.tsx` (delete local `navItems`, import shared)
- Test: `tests/lib/nav-items.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: `interface NavItem { href: string; label: string; icon: string; helpSlug: string }`; `const navItems: NavItem[]` (15 items, sidebar order); `function helpTopicForPath(pathname: string): NavItem` (longest-prefix match, falls back to the Overview item). All later tasks import these.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/nav-items.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItems, helpTopicForPath } from '../../components/layout/nav-items';

test('navItems has 15 entries with unique kebab-case help slugs', () => {
  assert.equal(navItems.length, 15);
  const slugs = navItems.map((n) => n.helpSlug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('exact page path maps to its topic', () => {
  assert.equal(helpTopicForPath('/dashboard/usage').helpSlug, 'usage');
});

test('nested path maps to its section topic, not overview', () => {
  assert.equal(helpTopicForPath('/dashboard/sessions/myproj/abc123').helpSlug, 'sessions');
});

test('dashboard root maps to overview', () => {
  assert.equal(helpTopicForPath('/dashboard').helpSlug, 'overview');
});

test('unknown path falls back to overview', () => {
  assert.equal(helpTopicForPath('/nowhere').helpSlug, 'overview');
});

test('prefix match requires a path-segment boundary', () => {
  // '/dashboard/sessionsX' must NOT match '/dashboard/sessions'
  assert.equal(helpTopicForPath('/dashboard/sessionsX').helpSlug, 'overview');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../components/layout/nav-items'`

- [ ] **Step 3: Create the shared module**

Create `components/layout/nav-items.ts` (labels/icons copied verbatim from the current `sidebar.tsx`):

```ts
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  helpSlug: string;
}

/** Single source of truth for dashboard navigation. The main sidebar and the
 *  help sidebar both render from this list, in this order. */
export const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: '⊞', helpSlug: 'overview' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: '◉', helpSlug: 'sessions' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◈', helpSlug: 'memory' },
  { href: '/dashboard/projects', label: 'Projects', icon: '◆', helpSlug: 'projects' },
  { href: '/dashboard/history', label: 'History', icon: '◷', helpSlug: 'history' },
  { href: '/dashboard/activity', label: 'Activity', icon: '⚡', helpSlug: 'activity' },
  { href: '/dashboard/usage', label: 'Usage & Cost', icon: '◐', helpSlug: 'usage' },
  { href: '/dashboard/sources', label: 'Sources', icon: '⛁', helpSlug: 'sources' },
  { href: '/dashboard/tools', label: 'Tool Analytics', icon: '⚙', helpSlug: 'tools' },
  { href: '/dashboard/observability', label: 'Observability', icon: '◎', helpSlug: 'observability' },
  { href: '/dashboard/claude-md', label: 'CLAUDE.md', icon: '◇', helpSlug: 'claude-md' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚑', helpSlug: 'settings' },
  { href: '/dashboard/file-history', label: 'File History', icon: '◫', helpSlug: 'file-history' },
  { href: '/dashboard/tasks', label: 'Mission Control', icon: '⌂', helpSlug: 'tasks' },
  { href: '/dashboard/search', label: 'Search', icon: '⌕', helpSlug: 'search' },
];

/** Longest-prefix match of a dashboard pathname (no query string) to its help
 *  topic. Falls back to Overview for unknown paths. */
export function helpTopicForPath(pathname: string): NavItem {
  let best: NavItem | undefined;
  for (const item of navItems) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ?? navItems[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all `nav-items` tests PASS (existing suites also still pass)

- [ ] **Step 5: Point the main sidebar at the shared module**

In `components/layout/sidebar.tsx`, delete the local `const navItems = [...]` block (lines 6–22) and add to the imports:

```ts
import { navItems } from './nav-items';
```

The rest of the component is unchanged.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/layout/nav-items.ts components/layout/sidebar.tsx tests/lib/nav-items.test.ts
git commit -m "feat(help): extract shared nav-items module with pathname→topic mapper"
```

---

### Task 2: Slugify helper + help content loader

**Files:**
- Create: `lib/slugify.ts`
- Create: `lib/help-content.ts`
- Create: `tests/fixtures/help/sample.md`
- Test: `tests/lib/help-content.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `function slugify(text: string): string` (in `lib/slugify.ts` — pure, importable from client components); `interface HelpSection { id: string; text: string }`; `interface HelpTopic { slug: string; title: string; body: string; sections: HelpSection[] }`; `function getHelpTopic(slug: string, dir?: string): HelpTopic | null` (in `lib/help-content.ts` — server-only, uses `fs`).

- [ ] **Step 1: Write the failing tests**

Create fixture `tests/fixtures/help/sample.md`:

```markdown
---
title: Sample Topic
---

Intro paragraph.

## First Section

Body text.

## Second — Section!

More text.
```

Create `tests/lib/help-content.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { slugify } from '../../lib/slugify';
import { getHelpTopic } from '../../lib/help-content';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'help');

test('slugify produces github-style anchors', () => {
  assert.equal(slugify('First Section'), 'first-section');
  assert.equal(slugify("Why is there an 'unknown' model?"), 'why-is-there-an-unknown-model');
  assert.equal(slugify('Second — Section!'), 'second-section');
});

test('getHelpTopic parses frontmatter title and body', () => {
  const topic = getHelpTopic('sample', FIXTURES);
  assert.ok(topic);
  assert.equal(topic.title, 'Sample Topic');
  assert.ok(topic.body.includes('Intro paragraph.'));
  assert.ok(!topic.body.includes('title:'), 'frontmatter must be stripped from body');
});

test('getHelpTopic extracts ## sections with anchor ids', () => {
  const topic = getHelpTopic('sample', FIXTURES);
  assert.ok(topic);
  assert.deepEqual(topic.sections, [
    { id: 'first-section', text: 'First Section' },
    { id: 'second-section', text: 'Second — Section!' },
  ]);
});

test('getHelpTopic returns null for a missing file', () => {
  assert.equal(getHelpTopic('does-not-exist', FIXTURES), null);
});

test('getHelpTopic rejects path-traversal slugs', () => {
  assert.equal(getHelpTopic('../secrets', FIXTURES), null);
  assert.equal(getHelpTopic('a/b', FIXTURES), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/slugify'`

- [ ] **Step 3: Implement slugify**

Create `lib/slugify.ts`:

```ts
/** GitHub-style heading anchor: lowercase, strip punctuation, spaces→hyphens.
 *  Kept dependency-free and fs-free so client components can import it. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 4: Implement the loader**

Create `lib/help-content.ts`:

```ts
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { slugify } from './slugify';

export interface HelpSection {
  id: string;
  text: string;
}

export interface HelpTopic {
  slug: string;
  title: string;
  body: string;
  sections: HelpSection[];
}

const DEFAULT_DIR = path.join(process.cwd(), 'content', 'help');

/** Load one help topic from content/help/<slug>.md. Returns null when the
 *  slug is malformed or the file is missing — callers render a fallback. */
export function getHelpTopic(slug: string, dir: string = DEFAULT_DIR): HelpTopic | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf-8');
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const title = typeof data.title === 'string' && data.title.length > 0 ? data.title : slug;
  const sections: HelpSection[] = [];
  for (const line of content.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) sections.push({ id: slugify(m[1]), text: m[1] });
  }
  return { slug, title, body: content, sections };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all `help-content` tests PASS

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors

```bash
git add lib/slugify.ts lib/help-content.ts tests/lib/help-content.test.ts tests/fixtures/help/sample.md
git commit -m "feat(help): markdown topic loader with frontmatter and section anchors"
```

---

### Task 3: Help content for all 15 pages + completeness test

**Files:**
- Create: `content/help/overview.md`, `content/help/sessions.md`, `content/help/memory.md`, `content/help/projects.md`, `content/help/history.md`, `content/help/activity.md`, `content/help/usage.md`, `content/help/sources.md`, `content/help/tools.md`, `content/help/observability.md`, `content/help/claude-md.md`, `content/help/settings.md`, `content/help/file-history.md`, `content/help/tasks.md`, `content/help/search.md`
- Test: `tests/lib/help-completeness.test.ts`

**Interfaces:**
- Consumes: `navItems` (Task 1), `getHelpTopic` (Task 2).
- Produces: the 15 markdown files the topic pages (Task 5) render.

- [ ] **Step 1: Write the failing completeness test**

Create `tests/lib/help-completeness.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItems } from '../../components/layout/nav-items';
import { getHelpTopic } from '../../lib/help-content';

test('every nav item has a real help topic (title + non-stub body)', () => {
  for (const item of navItems) {
    const topic = getHelpTopic(item.helpSlug);
    assert.ok(topic, `missing content/help/${item.helpSlug}.md`);
    assert.ok(topic.title.length > 0, `${item.helpSlug}: empty title`);
    assert.ok(
      topic.body.trim().length > 300,
      `content/help/${item.helpSlug}.md is a stub (${topic.body.trim().length} chars)`,
    );
    assert.ok(
      topic.sections.length >= 2,
      `${item.helpSlug}: needs at least two ## sections for the TOC/paging`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `missing content/help/overview.md`

- [ ] **Step 3: Write `content/help/usage.md` (verbatim — this one is specified exactly)**

```markdown
---
title: Usage & Cost
---

This page aggregates token usage and estimated cost across every Claude Code
session on this machine (plus any extra sources you've added on the Sources
page). It reads the session `.jsonl` files under `~/.claude/projects/`,
deduplicates streamed events, and prices them with LiteLLM's published
per-model rates — the same method the `ccusage` CLI uses, so the two agree.

## Reading the numbers

Each row breaks tokens into four buckets: **input**, **output**, **cache
creation**, and **cache read**. Cache reads are much cheaper than fresh input
tokens, which is why a session with millions of cache-read tokens can still
cost cents. **Cost** is estimated from LiteLLM pricing — live rates when
available, a bundled fallback table otherwise (the badge in the header shows
which one priced the report).

## Filters and controls

- **Date range** — since/until, inclusive, in your local timezone.
- **Granularity** — bucket the chart by day, week (Monday start), or month.
- **Projects / Models / Sources** — multi-select filters. They combine: a
  model filter of `claude-fable-5` plus a project filter shows only that
  model's usage inside those projects.
- Filter options are built from *all* data, not the filtered view, so you can
  always widen a filter back out.

## Why is there an "unknown" model?

Claude Code sometimes writes locally-generated placeholder messages into
session files — for example "No response requested." or an API-error notice.
These carry the pseudo-model `<synthetic>` and zero tokens in every bucket,
because no API request ever happened. The dashboard groups them under
**unknown**, which is why that row always shows 0 tokens and $0.00. It never
affects totals; you can filter it out (or just ignore it).

## Fast mode

Entries produced in fast mode are shown as a separate `-fast` model variant
(e.g. `claude-opus-4-8-fast`) and priced with the fast-mode output-token
multiplier, so regular and fast usage of the same model stay distinguishable.

## Sessions table

The bottom table attributes usage to individual sessions, with per-model
breakdowns, message counts, and first/last activity timestamps. Use it to
find which session or project is driving cost.
```

- [ ] **Step 4: Write the other 14 topic files**

For each remaining slug, **read that page's source first** (`app/dashboard/<segment>/page.tsx` and the components it imports; Overview is `app/dashboard/page.tsx`), then write the topic. Required shape for every file:

1. YAML frontmatter with `title:` matching the sidebar label (e.g. `title: Mission Control` for `tasks.md`).
2. An intro paragraph (no heading) saying what the page is for and where its data comes from (most pages read `~/.claude/` via the API routes).
3. At least two `##` sections chosen from what the page actually shows: one walking through the main content areas, one covering controls (filters, search boxes, buttons, refresh behavior), plus a `## Tips` or gotcha section where you learned something non-obvious from the code.
4. Body length well past the 300-char test floor — these are real docs, not stubs.
5. Plain GitHub-flavored markdown only (headings, lists, tables, `code`); no HTML, no images.

Accuracy rule: every claim must be verifiable in the page's code. If the code is ambiguous, describe the behavior you can verify and omit speculation. Do not invent features.

- [ ] **Step 5: Run the completeness test to verify it passes**

Run: `npm test`
Expected: `help-completeness` PASSES — all 15 topics present, titled, non-stub, ≥2 sections

- [ ] **Step 6: Commit**

```bash
git add content/help/ tests/lib/help-completeness.test.ts
git commit -m "feat(help): author help topics for all 15 dashboard pages"
```

---

### Task 4: Help chrome — sidebar, banner, layout

**Files:**
- Create: `components/help/help-return.ts`
- Create: `components/help/help-sidebar.tsx`
- Create: `components/help/help-banner.tsx`
- Create: `app/help/layout.tsx`

**Interfaces:**
- Consumes: `navItems`, `helpTopicForPath` (Task 1).
- Produces: `HELP_RETURN_KEY = 'help-return-to'` (Task 6's button writes it; the banner reads it); `<HelpSidebar />`, `<HelpBanner />` (default exports); the `/help/*` layout shell that Task 5's pages render inside.

No unit tests — this repo has no component-test setup and the logic-bearing pieces (mapper, loader) are already covered. Verification is `tsc` here and the manual walkthrough in Task 7.

- [ ] **Step 1: Create the shared storage-key module**

Create `components/help/help-return.ts`:

```ts
/** sessionStorage key holding the dashboard URL (path + query) to return to
 *  when help is closed. Written by HelpButton, read by HelpBanner. */
export const HELP_RETURN_KEY = 'help-return-to';
```

- [ ] **Step 2: Create the help sidebar**

Create `components/help/help-sidebar.tsx` — same geometry as the main sidebar, amber skin, links to help topics:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from '@/components/layout/nav-items';

export default function HelpSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-brand-navy-dark border-r border-chameleon-amber/30 flex flex-col min-h-screen shrink-0">
      <div className="p-5 border-b border-chameleon-amber/30">
        <h1 className="font-heading text-xl text-chameleon-amber">Help</h1>
        <p className="text-xs text-gray-500 mt-1">Claude Code Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const href = `/help/${item.helpSlug}`;
          const isActive = pathname === href;
          return (
            <Link
              key={item.helpSlug}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-chameleon-amber/10 text-chameleon-amber border border-chameleon-amber/20'
                  : 'text-gray-400 hover:text-white hover:bg-brand-navy-light/50 border border-transparent'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-chameleon-amber/30 text-xs text-gray-600">
        <span className="text-gray-500">Press</span>{' '}
        <kbd className="px-1.5 py-0.5 bg-brand-navy-light rounded text-chameleon-amber text-[10px]">Esc</kbd>{' '}
        <span className="text-gray-500">to close help</span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create the help banner**

Create `components/help/help-banner.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { helpTopicForPath } from '@/components/layout/nav-items';
import { HELP_RETURN_KEY } from './help-return';

export default function HelpBanner() {
  const router = useRouter();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(sessionStorage.getItem(HELP_RETURN_KEY));
  }, []);

  const close = useCallback(() => {
    router.push(origin ?? '/dashboard');
  }, [router, origin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const backLabel = helpTopicForPath((origin ?? '/dashboard').split('?')[0]).label;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-4 px-6 py-3 bg-chameleon-amber/10 border-b border-chameleon-amber/30 backdrop-blur">
      <div className="flex items-center gap-3 text-sm">
        <span className="px-2 py-0.5 rounded bg-chameleon-amber text-brand-navy-dark font-bold text-xs">
          ? HELP
        </span>
        <span className="text-gray-300">You&apos;re browsing Help</span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={close} className="text-sm text-chameleon-amber hover:underline">
          ← Back to {backLabel}
        </button>
        <button
          onClick={close}
          aria-label="Close help"
          className="w-7 h-7 rounded-lg border border-chameleon-amber/40 text-chameleon-amber hover:bg-chameleon-amber/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the help layout**

Create `app/help/layout.tsx`:

```tsx
import HelpSidebar from '@/components/help/help-sidebar';
import HelpBanner from '@/components/help/help-banner';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-brand-navy">
      <HelpSidebar />
      <main className="flex-1 flex flex-col overflow-auto">
        <HelpBanner />
        <div className="p-8 max-w-3xl w-full">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors

```bash
git add components/help/help-return.ts components/help/help-sidebar.tsx components/help/help-banner.tsx app/help/layout.tsx
git commit -m "feat(help): help-mode chrome — amber sidebar, return banner, layout"
```

---

### Task 5: Topic pages — markdown rendering, TOC, pager, index

**Files:**
- Create: `components/help/help-markdown.tsx`
- Create: `components/help/topic-pager.tsx`
- Create: `app/help/page.tsx`
- Create: `app/help/[topic]/page.tsx`

**Interfaces:**
- Consumes: `navItems` (Task 1), `slugify` (Task 2), `getHelpTopic` (Task 2), help layout (Task 4).
- Produces: the working `/help` and `/help/<topic>` routes.

- [ ] **Step 1: Create the markdown renderer with heading anchors**

`components/ui/markdown.tsx` stays untouched (other pages use it); help needs custom `h2` renderers for anchor ids, so it gets its own variant. Create `components/help/help-markdown.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugify } from '@/lib/slugify';

function headingText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(headingText).join('');
  return '';
}

export default function HelpMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-invert max-w-none
      prose-headings:text-chameleon-amber prose-headings:font-heading prose-headings:scroll-mt-20
      prose-a:text-brand-cyan-light prose-a:no-underline hover:prose-a:underline
      prose-code:text-chameleon-amber prose-code:bg-brand-navy-dark prose-code:px-1 prose-code:rounded
      prose-pre:bg-brand-navy-dark prose-pre:border prose-pre:border-brand-navy-light/30
      prose-strong:text-white
      prose-th:text-gray-300 prose-td:text-gray-400
      prose-hr:border-brand-navy-light/30"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={slugify(headingText(children))}>{children}</h2>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

(`scroll-mt-20` keeps anchor targets clear of the sticky banner.)

- [ ] **Step 2: Create the prev/next pager**

Create `components/help/topic-pager.tsx` (server component, no hooks):

```tsx
import Link from 'next/link';
import { navItems } from '@/components/layout/nav-items';

export default function TopicPager({ slug }: { slug: string }) {
  const i = navItems.findIndex((n) => n.helpSlug === slug);
  if (i === -1) return null;
  const prev = i > 0 ? navItems[i - 1] : undefined;
  const next = i < navItems.length - 1 ? navItems[i + 1] : undefined;

  return (
    <nav className="mt-10 pt-4 border-t border-brand-navy-light/30 flex items-center justify-between text-sm">
      {prev ? (
        <Link href={`/help/${prev.helpSlug}`} className="text-chameleon-amber hover:underline">
          ◀ Prev: {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`/help/${next.helpSlug}`} className="text-chameleon-amber hover:underline">
          Next: {next.label} ▶
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
```

- [ ] **Step 3: Create the help index redirect**

Create `app/help/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function HelpIndex() {
  redirect('/help/overview');
}
```

- [ ] **Step 4: Create the topic page**

Create `app/help/[topic]/page.tsx`. Next 16 server pages receive `params` as a Promise:

```tsx
import Link from 'next/link';
import { navItems } from '@/components/layout/nav-items';
import { getHelpTopic } from '@/lib/help-content';
import HelpMarkdown from '@/components/help/help-markdown';
import TopicPager from '@/components/help/topic-pager';

export const dynamic = 'force-dynamic';

export default async function HelpTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic: slug } = await params;
  const navItem = navItems.find((n) => n.helpSlug === slug);

  if (!navItem) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-chameleon-amber mb-4">Topic not found</h1>
        <p className="text-gray-400 mb-6">
          No help topic named &ldquo;{slug}&rdquo;. Pick one below:
        </p>
        <ul className="space-y-1.5">
          {navItems.map((n) => (
            <li key={n.helpSlug}>
              <Link href={`/help/${n.helpSlug}`} className="text-chameleon-amber hover:underline">
                {n.icon} {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const topic = getHelpTopic(slug);
  if (!topic) {
    return (
      <div>
        <h1 className="font-heading text-3xl text-chameleon-amber mb-4">{navItem.label}</h1>
        <p className="text-gray-400">No help written for this page yet.</p>
        <TopicPager slug={slug} />
      </div>
    );
  }

  return (
    <article>
      <h1 className="font-heading text-3xl text-chameleon-amber mb-2">{topic.title}</h1>
      {topic.sections.length > 1 && (
        <nav className="mb-6 text-sm text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          {topic.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="hover:text-chameleon-amber">
              {s.text}
            </a>
          ))}
        </nav>
      )}
      <HelpMarkdown content={topic.body} />
      <TopicPager slug={slug} />
    </article>
  );
}
```

- [ ] **Step 5: Typecheck, build, and smoke-check the routes**

Run: `npx tsc --noEmit` — expected: no errors
Run: `npm run build` — expected: build succeeds; route list includes `/help` and `/help/[topic]`

- [ ] **Step 6: Commit**

```bash
git add components/help/help-markdown.tsx components/help/topic-pager.tsx app/help/page.tsx "app/help/[topic]/page.tsx"
git commit -m "feat(help): topic pages with markdown rendering, TOC anchors, prev/next pager"
```

---

### Task 6: The ? entry point — button, keyboard shortcut, footer hint

**Files:**
- Create: `components/help/help-button.tsx`
- Modify: `app/dashboard/layout.tsx`
- Modify: `components/layout/sidebar.tsx` (footer hint)

**Interfaces:**
- Consumes: `helpTopicForPath` (Task 1), `HELP_RETURN_KEY` (Task 4), routes (Task 5).
- Produces: the user-facing entry point; nothing downstream consumes it.

- [ ] **Step 1: Create the help button**

Create `components/help/help-button.tsx`. It reads `window.location` inside event handlers (never during render), so it needs no `useSearchParams`/Suspense and captures the query string for exact return:

```tsx
'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { helpTopicForPath } from '@/components/layout/nav-items';
import { HELP_RETURN_KEY } from './help-return';

export default function HelpButton() {
  const router = useRouter();

  const openHelp = useCallback(() => {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem(HELP_RETURN_KEY, origin);
    router.push(`/help/${helpTopicForPath(window.location.pathname).helpSlug}`);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      openHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openHelp]);

  return (
    <button
      onClick={openHelp}
      aria-label="Open help for this page"
      title="Help (?)"
      className="fixed top-5 right-6 z-50 w-9 h-9 rounded-full border border-brand-cyan/30 bg-brand-navy-dark/80 text-brand-cyan text-lg font-bold backdrop-blur hover:bg-brand-cyan/10 hover:border-brand-cyan/60 transition-colors"
    >
      ?
    </button>
  );
}
```

- [ ] **Step 2: Mount it in the dashboard layout**

Replace the full contents of `app/dashboard/layout.tsx` with:

```tsx
import Sidebar from '@/components/layout/sidebar';
import HelpButton from '@/components/help/help-button';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-brand-navy">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
      <HelpButton />
    </div>
  );
}
```

- [ ] **Step 3: Add the ? hint to the main sidebar footer**

In `components/layout/sidebar.tsx`, replace the footer `<div>` (the block containing the `/` kbd hint) with:

```tsx
      <div className="p-3 border-t border-brand-navy-light/30 text-xs text-gray-600 space-y-1">
        <div>
          <span className="text-gray-500">Press</span>{' '}
          <kbd className="px-1.5 py-0.5 bg-brand-navy-light rounded text-brand-cyan text-[10px]">/</kbd>{' '}
          <span className="text-gray-500">to search</span>
        </div>
        <div>
          <span className="text-gray-500">Press</span>{' '}
          <kbd className="px-1.5 py-0.5 bg-brand-navy-light rounded text-brand-cyan text-[10px]">?</kbd>{' '}
          <span className="text-gray-500">for help</span>
        </div>
      </div>
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors

```bash
git add components/help/help-button.tsx app/dashboard/layout.tsx components/layout/sidebar.tsx
git commit -m "feat(help): ? button, keyboard shortcut, and sidebar hint"
```

---

### Task 7: Full verification + docs touch-up

**Files:**
- Modify: `CLAUDE.md` (Architecture section — add help routes/content; correct the stale "Next.js 14" to 16)

**Interfaces:**
- Consumes: everything above.
- Produces: verified feature; updated project docs.

- [ ] **Step 1: Run the full gate**

```bash
npm test          # all suites incl. nav-items, help-content, help-completeness
npx tsc --noEmit  # no errors
npm run lint      # no new warnings/errors in touched files
npm run build     # succeeds; /help routes listed
```

- [ ] **Step 2: Manual walkthrough (`npm run dev`, http://localhost:3000)**

Verify each; fix anything that fails before committing:

1. `?` button visible top-right on Overview, Usage & Cost, and Sessions.
2. On `/dashboard/usage` with filters applied (query string present), click `?` → lands on `/help/usage`; banner reads "← Back to Usage & Cost".
3. Help mode is visually distinct: amber sidebar accents, `? HELP` badge, banner.
4. Sidebar mirrors the main nav 1:1 (same order, icons, labels); clicking items switches topics.
5. Usage topic shows the mini-TOC; clicking "Why is there an 'unknown' model?" scrolls to the section (not hidden under the banner).
6. Prev/next pager walks the full topic sequence; Overview has no Prev, Search has no Next.
7. Navigate several topics, then ✕ → returns to `/dashboard/usage` **with the original query string intact**. Repeat with Esc and with the "← Back to" link.
8. Keyboard: `?` from a dashboard page opens help; `?` typed inside the search input does NOT.
9. Direct visit to `/help/usage` in a fresh tab (no stored origin) → ✕ returns to `/dashboard`.
10. `/help/bogus` → "Topic not found" list; `/help` → redirects to `/help/overview`.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md` Architecture section add two lines:

```markdown
- `app/help/` — help-mode routes (`/help/<topic>`) with mirrored amber sidebar
- `content/help/` — markdown help topics, one per nav page (loaded by `lib/help-content.ts`)
```

And in Tech Stack, change `Next.js 14 App Router` → `Next.js 16 App Router`.

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: register help system in CLAUDE.md architecture map"
```
