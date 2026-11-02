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

## Scanning & review

Policy lives in `~/.config/agents/AGENTS.md` -> "Dependency, code, and secret
scanning" and "Model delegation & cross-provider review". It is not restated
here; read it there. What is specific to this repo:

- CI runs `gitleaks`, `npm audit signatures`, `npm audit`, and `osv-scanner` on
  every PR, every push to `master`, and weekly
  (`.github/workflows/security.yml`).
- Dependabot config is committed, with grouped security PRs (`.github/dependabot.yml`).
- SHA-pinned actions get **no Dependabot alerts**: GitHub generates them only
  for actions on semantic versions (docs: "About Dependabot alerts"). So no
  security-update PR can ever fire for a pinned action, an
  `applies-to: security-updates` group over github-actions is dead config, and
  the weekly version update is their only automatic remediation -- which is why
  the github-actions block carries no semver-major ignore. DETECTION comes from
  osv-scanner's `github/actions` plugin, which is NOT in its default plugin set
  and so is named explicitly in `security.yml`.
- Dependabot **alerts** are a per-repo GitHub setting; a config file does not
  turn them on. Without them the config above governs version updates only.
  Check it by HTTP STATUS, not by exit code -- `gh api` exits 0 on success
  and 1 on any failure, and never exits 404 or 403:
  `gh api -i -X GET repos/Chameleon-Labs-LLC/ClaudeCodeDashboard/vulnerability-alerts | head -1`
  204 = on, 404 = off, 403 = the token has no admin on this repo, which is
  NOT the same as off. Enable: same path with `-X PUT`.
- Alerts and automatic security **updates** are two switches, not one. Alerts
  only report; the half that opens PRs is `automated-security-fixes` (same API
  shape). It is deliberately OFF here: this repo took its first scan with a
  pre-existing advisory backlog, and enabling it would open that backlog as
  PRs at once. Turn it on per repo once the backlog is cleared.
- PR reviewers configured for this repo: **Codex** (run locally against the
  committed branch before opening the PR), **CodeRabbit**
  (`coderabbitai[bot]`) and **GrepTile** (`greptile-apps[bot]`, tuned in
  `.greptile/config.json`). How to read their checks -- which one re-reviews
  a push, why a green check does not mean "no findings", and which label
  skips which bot -- is in the global policy cited above and is deliberately
  not repeated here.
## Pointers

- Docs and notes: `Docs/`, `Notes/`.
