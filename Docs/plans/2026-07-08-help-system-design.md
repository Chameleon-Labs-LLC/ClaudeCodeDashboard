# Context-Sensitive Help System — Design

**Date:** 2026-07-08
**Status:** Approved (design review with Leland, 2026-07-08)

## Goal

A `?` icon at the top right of every dashboard page opens a context-sensitive,
paged help system. Help mirrors the main UI's navigation so users learn where
features live, is visually unmistakable as "help mode," and closing it returns
the user to the exact page (URL) they came from.

## Decisions (from design review)

1. **Shape:** Help-mode routes — real `/help/<topic>` URLs with a help-skinned
   twin of the main sidebar. (Chosen over slide-over drawer and client-only
   full-screen overlay: deep-linkable, browser back works, room for long topics,
   and the mirrored nav is the teaching device.)
2. **Content depth:** Full content for all 15 nav pages in v1 — no stubs.

## Architecture

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/help` | `app/help/page.tsx` | Redirects to `/help/overview` |
| `/help/<topic>` | `app/help/[topic]/page.tsx` | Renders one help topic (server component) |
| — | `app/help/layout.tsx` | Help chrome: `HelpSidebar` + help banner |

Help lives **outside** `app/dashboard/layout.tsx` so it does not inherit the
main sidebar; it renders its own chrome.

### Shared nav definition

`navItems` moves from `components/layout/sidebar.tsx` to
`components/layout/nav-items.ts`, exporting for each item:

- `href` — dashboard route (`/dashboard/usage`)
- `label` — display label (`Usage & Cost`)
- `icon` — glyph
- `helpSlug` — topic slug derived from the path segment (`usage`; the
  Overview item at `/dashboard` uses `overview`)

Both `Sidebar` and `HelpSidebar` import this module, so the two navs cannot
drift. Topic order everywhere (sidebar, prev/next pager) is `navItems` order.

Slugs: `overview`, `sessions`, `memory`, `projects`, `history`, `activity`,
`usage`, `sources`, `tools`, `observability`, `claude-md`, `settings`,
`file-history`, `tasks`, `search`.

### Components

- **`components/help/help-button.tsx`** (client) — fixed top-right `?` button
  rendered once in `app/dashboard/layout.tsx`. On click (or `Shift+/` when no
  input/textarea is focused): longest-prefix match of current pathname against
  `navItems[].href` → `router.push('/help/<helpSlug>')`. Before navigating,
  stores the origin (`pathname + search`) in `sessionStorage['help-return-to']`
  (only when not already in help).
- **`components/help/help-sidebar.tsx`** (client) — mirror of `Sidebar`, same
  geometry/order/icons, but: amber accent instead of cyan, header shows
  "? HELP" badge, items link to `/help/<helpSlug>`, active state matches the
  current topic. Footer hint: `Esc` to close help.
- **`components/help/help-banner.tsx`** (client) — persistent bar across the
  top of help content: "You're browsing Help — ← Back to <origin page label>"
  plus a `✕` button. Both return to the stored origin URL; `Esc` keydown does
  the same. Fallback origin: `/dashboard`.
- **`components/help/topic-pager.tsx`** — bottom prev/next links in `navItems`
  order ("◀ Prev: Activity · Next: Sources ▶").
- **Mini-TOC** — the topic page extracts `##` headings from the markdown and
  renders an anchor list under the title.

### Content pipeline

- One file per topic: `content/help/<slug>.md` (15 files), YAML frontmatter
  (`title`), body in GitHub-flavored markdown.
- Loader `lib/help-content.ts`: reads the file (Node `fs`, server-side only),
  parses frontmatter with the already-present `gray-matter`, extracts `##`
  headings for the TOC. This is repo content, not `~/.claude` data, so the
  "data access via API routes" convention does not apply.
- Rendering: `react-markdown` + `remark-gfm` (already installed) with heading
  ids for anchor links, styled for the dark theme (prose width capped for
  readability).
- Content requirement: each topic documents what the page shows, its controls/
  filters, and known gotchas. The **usage** topic must include a
  "Why is there an `unknown` model?" section explaining synthetic zero-token
  placeholder entries (model `<synthetic>`, e.g. "No response requested.")
  that carry no cost and don't affect totals.

## Visual identity (help mode)

- Amber accent (`#f59e0b` family) replaces cyan in the help sidebar and active
  states; "? HELP" badge in the sidebar header.
- Persistent help banner at the top of the content column with the return
  affordance.
- Same layout geometry as the dashboard — the mirroring is deliberate; the
  color shift + badge + banner make the mode obvious.
- Main sidebar footer gains a `?` hint line next to the existing `/` search
  hint.

## Error handling

- Unknown topic slug → help index page listing all topics (Next.js
  `notFound()`-adjacent soft landing, not a bare 404).
- Missing content file for a valid slug → "No help written for this page yet"
  fallback panel (should not occur in v1; completeness test guards it).
- No stored origin (direct `/help/...` visit) → close returns to `/dashboard`.
- `Shift+/` handler ignores keystrokes inside inputs/textareas/contenteditable.

## Testing

- **Unit (vitest):**
  - pathname→topic mapper: exact match, nested paths
    (`/dashboard/sessions/abc` → `sessions`), root (`/dashboard` → `overview`),
    unknown path → `overview` fallback.
  - `lib/help-content.ts`: frontmatter parse, `##` TOC extraction.
  - Completeness: every `navItems[].helpSlug` has a `content/help/<slug>.md`.
- **Pre-commit:** `npx tsc --noEmit` and `npm run build` must pass.
- **Manual:** `npm run dev` — open help from several pages, navigate topics,
  close via ✕/Esc/back-link, confirm return to origin including query params.

## Out of scope (v1)

- Full-text search within help topics (main `/` search already exists; can
  index help later).
- Per-section deep context (e.g., a `?` next to individual widgets).
- Auto-generated screenshots or images in topics.
