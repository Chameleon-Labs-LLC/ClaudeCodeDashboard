# ClaudeCodeDashboard — agent guide

Local Next.js dashboard for Claude Code. It reads `~/.claude/` directly, keeps derived data in a local SQLite file, and runs with no auth and no cloud backend. `README.md` describes the pages and optional extras (OTel ingest, Mission Control daemon).

## Hard rules

- `npm run dev` binds to `0.0.0.0` with no auth. Do not add exposure beyond trusted networks. Do not add remote-access features without an auth layer.
- All filesystem access goes through API routes in `app/api/`. Never read the filesystem from client components.
- The primary Claude root (`CLAUDE_HOME`, default `~/.claude/`) is never stored in the sources registry (ccd/sources.json under the Claude root, see `lib/usage-sources.ts`). It is always the implicit "local" source.

## Gotchas

- The repo is shared between PowerShell and WSL on `/mnt/d`. `node_modules/better-sqlite3` holds the Windows binary. In WSL, run `scripts/provision-linux-sqlite.sh` once; it side-loads a Linux build into `.native/linux-<arch>/`. Re-run after a Node or better-sqlite3 upgrade.
- Git tracks the directory as `scripts/`. The drvfs mount shows `Scripts/`. Always write `scripts/` in paths and docs.
- Two test runners exist. `npm test` runs the node test runner over `tests/`. `npm run test:otel` and `npm run test:integration` run vitest over `__tests__/`. Put a new test in the directory that matches its runner.
- Resolve the Claude root with `lib/claude-home.ts`, not with `os.homedir()` directly. Tests override `CLAUDE_HOME`.

## Conventions

- Data access layer: `lib/claude-data.ts`. Shared types: `types/`. Help topics: one markdown file per nav page in `content/help/`, loaded by `lib/help-content.ts`.
- Brand: ChameleonLabs dark theme (navy background, cyan accents). Help mode uses a mirrored amber sidebar.

## Pointers

- Docs and notes: `Docs/`, `Notes/`.
