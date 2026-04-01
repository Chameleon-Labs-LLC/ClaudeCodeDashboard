# ClaudeCodeDashboard — CLAUDE.md

## Project Overview
Local GUI dashboard for Claude Code — browse sessions, manage memory, search, and inspect usage.
Reads directly from `~/.claude/` filesystem. No database, no auth, no deployment — purely local.

## Tech Stack
- Next.js 14 App Router, TypeScript, Tailwind CSS
- File-system based data (reads `~/.claude/` directory)
- gray-matter for YAML frontmatter parsing
- Fuse.js for client-side fuzzy search
- lucide-react for icons

## Development
- TypeScript check: `npx tsc --noEmit`
- Build: `npm run build`
- Dev server: `npm run dev`
- Lint: `npm run lint`

## Key Conventions
- All data access via API routes in `app/api/` — never read filesystem from client components
- API routes read from `CLAUDE_HOME` env var or default `~/.claude/`
- Types for Claude Code data structures in `types/`
- Dashboard uses sidebar layout with nav in `components/layout/`
- Brand: ChameleonLabs dark theme (navy bg, cyan accents)

## Architecture
- `lib/claude-data.ts` — core data access layer for reading Claude Code files
- `app/api/sessions/` — session listing and detail endpoints
- `app/api/memory/` — memory CRUD endpoints
- `app/api/search/` — full-text search endpoint
- `app/dashboard/` — main dashboard layout and pages

## Debugging / Production
- This is a local-only tool — no production deployment
- Test with `npm run dev` on localhost:3000
