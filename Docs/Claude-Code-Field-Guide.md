# Claude Code: The Power User's Field Guide

> A practitioner's manual for getting compounding leverage out of [Claude Code](https://github.com/anthropics/claude-code) — settings that pay rent, a `CLAUDE.md` that earns its tokens, hooks that automate the harness, and subagents that run as a team.

This guide assumes you've already used Claude Code for a few sessions and want to stop fighting it and start *operating* it. Everything here is sourced from official Anthropic documentation, the broader Claude Code community (especially [IndyDevDan](https://www.youtube.com/@indydevdan)), and direct daily use.

Maintainer: [Leland Green](https://github.com/lelandg) ([Chameleon Labs, LLC](https://github.com/Chameleon-Labs-LLC)). Live link list at the bottom.

---

## 1. The mental model: harness vs. model

Claude Code is two things stacked on top of each other:

1. **The harness** — the local CLI process. It owns the filesystem, runs your hooks, manages permissions, dispatches subagents, loads `CLAUDE.md`, and decides which tool calls are safe to run.
2. **The model** — Claude itself. It writes code, reasons about your repo, and emits tool calls.

Almost every "how do I make Claude *always* do X?" question is really a harness question, not a model question. The model forgets between sessions; the harness doesn't. Anything you want to be deterministic — a check before commits, an audit log, a permission rule, a dev server start — belongs in the harness (settings, hooks, skills), not in a polite request inside `CLAUDE.md`.

Internalize this and the rest of the guide makes sense.

---

## 2. Settings: the three layers

Settings live in `settings.json` files at three scopes, in *increasing* precedence:

| Scope | Location | Use it for |
|---|---|---|
| **User** | `~/.claude/settings.json` | Defaults that apply to every project — your model, output style, global allow-list, your favorite MCP servers, hooks you want everywhere. |
| **Project (shared)** | `<repo>/.claude/settings.json` | Team-wide rules — language-specific permissions, lint hooks, project skills. **Commit this.** |
| **Project (local)** | `<repo>/.claude/settings.local.json` | *Your* tweaks for this repo — a noisy hook you've muted, a permission you trust on your machine. **Auto-gitignored.** |

Command-line flags trump all three. The `/permissions` slash command shows the merged result.

### What actually goes in there

```jsonc
// ~/.claude/settings.json (user-level, the most useful entries)
{
  "model": "claude-opus-latest",
  "outputStyle": "default",
  "permissions": {
    "allow": [
      "Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)",
      "Bash(npm run lint)", "Bash(npm test)",
      "Read(~/.claude/**)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Read(.env)", "Read(.env.*)"
    ]
  },
  "env": {
    "CLAUDE_CODE_DISABLE_TELEMETRY": "0"
  }
}
```

### Power-user heuristics

- **Default to project, escape to local.** Add a permission to project settings only after you've used it for a week in `.local.json` and confirmed it's safe everywhere.
- **Specific over broad.** `Bash(npm test)` is safe, `Bash(npm:*)` is not — `npm install` can run arbitrary install scripts.
- **Explicit denies beat implicit allows.** Even in `acceptEdits` mode, `Read(.env)` in `deny` will block.
- **Use `/fewer-permission-prompts`** (a built-in skill) to mine your transcripts for read-only commands you keep approving and add them to project settings in one pass.

Reference: [Settings docs](https://docs.claude.com/en/docs/claude-code/settings) · [Permissions docs](https://docs.claude.com/en/docs/claude-code/iam)

---

## 3. CLAUDE.md: write less, weight more

Every line of `CLAUDE.md` costs context on every turn. Treat it like a tattoo, not a notepad.

### What belongs

- **How to build, test, and lint** — exact commands, no narration.
- **Conventions that aren't visible from the code** — "all data access goes through API routes," "we never `cd`," "uses Bun, not Node."
- **Forbidden patterns and *why* briefly** — "don't mock the DB; mocks masked a migration bug last quarter."
- **Pointers, not prose** — "Architecture overview lives in `docs/architecture.md`; load it when touching the data layer."

### What does NOT belong

- Recent changes / git history (`git log` is authoritative).
- Re-explanations of your folder structure (the model can `ls`).
- "Please be careful" — politeness is not enforcement; use a hook.
- Long examples, code samples, or anything you'd need to scroll past.

### The layered approach

`CLAUDE.md` walks **up** from your current directory, concatenating everything it finds. Use this:

```
~/.claude/CLAUDE.md            # cross-project preferences (your tone, your tools)
<repo>/CLAUDE.md               # whole-project conventions
<repo>/app/api/CLAUDE.md       # only loads when working in /app/api
<repo>/docs/CLAUDE.md          # docs-style rules, only when in /docs
```

Sub-directory `CLAUDE.md` files only load when you're actually working there — a free 70% context cut on subsystems you're not touching.

### A good `CLAUDE.md` template

```markdown
# <Project> — CLAUDE.md

## Stack
Next.js 14 App Router, TypeScript strict, Tailwind, Postgres via Prisma.

## Commands
- Type check: `npx tsc --noEmit`
- Test: `npm test`
- Dev server: `npm run dev` (port 3000)
- Lint+format on save (configured in editor)

## Conventions
- All filesystem reads from API routes only — never client components.
- Types live in `types/`; API responses are typed end-to-end.
- New env vars must be added to `lib/env.ts` AND documented in README.

## Forbidden
- Don't mock the database in tests — see `docs/why-no-mocks.md`.
- Don't commit `claude_output.txt` (debug artifact).

## Pointers
- Architecture: `docs/architecture.md` (load when touching data layer)
- Brand/design: `docs/design-system.md`
```

Reference: [Memory docs (CLAUDE.md)](https://docs.claude.com/en/docs/claude-code/memory)

---

## 4. Permission modes: pick the right gear

Cycle modes with **Shift+Tab**. They are gears, not opinions about how brave you are.

| Mode | Use when |
|---|---|
| `default` | Onboarding a new repo, anything touching infra, anything irreversible. |
| `acceptEdits` | You're doing focused implementation work in code you understand and trust. Edits + safe Bash auto-approve. |
| `plan` | "Show me what you'd do but don't touch anything." Great for architecture chats and onboarding to a new codebase. |
| `auto` | Long-running, somewhat trusted work — a safety classifier reviews each action. |
| `bypassPermissions` | **Sandboxed VMs only.** Never on your machine. |

The `plan` mode pairs with the **`EnterPlanMode` / `ExitPlanMode`** flow: Claude proposes, you approve, then it executes. Use it for any change that spans more than ~3 files.

Reference: [Permission modes](https://docs.claude.com/en/docs/claude-code/iam#permission-modes)

---

## 5. Hooks: the harness's nervous system

Hooks fire on lifecycle events. They run as commands the harness executes — not requests it makes of Claude. That makes them *deterministic*, which is the whole point.

### Events you'll actually use

| Event | Fires when | Use for |
|---|---|---|
| `SessionStart` | New or resumed session | Inject project context, start dev servers, set env vars |
| `UserPromptSubmit` | After you press Enter | Log prompts for telemetry/audit, redact secrets |
| `PreToolUse` | Before any tool call | Block dangerous commands, require justification, gate by file path |
| `PostToolUse` | After a tool call returns | Auto-format on edit, run typecheck after writes, log changes |
| `Stop` | Claude is about to wait for you | Notify, snapshot state, push to a queue |
| `Notification` | UI notification | Forward to Slack/Telegram/desktop |

### Pattern: format and typecheck on every edit

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npx prettier --write \"$CLAUDE_TOOL_FILE_PATH\"" },
          { "type": "command", "command": "npx tsc --noEmit", "timeout": 30 }
        ]
      }
    ]
  }
}
```

### Pattern: hard-block force pushes

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_TOOL_INPUT\" | grep -qE 'push.*--force'; then echo 'blocked'; exit 2; fi"
          }
        ]
      }
    ]
  }
}
```

Exit code `2` from a hook **blocks** the tool call and surfaces the message to Claude. Exit code `0` allows it.

### Where to learn this properly

IndyDevDan's [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) is the single best reference outside Anthropic's own docs. Pair it with [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) if you want to *see* what your hooks are doing in real time.

Reference: [Hooks docs](https://docs.claude.com/en/docs/claude-code/hooks) · [Hooks guide](https://docs.claude.com/en/docs/claude-code/hooks-guide)

---

## 6. Slash commands and skills

These look identical from the user side (`/something`) but mean different things.

- **Built-in slash commands** are baked into the harness: `/init`, `/model`, `/permissions`, `/compact`, `/resume`, `/review`, `/loop`, `/help`.
- **Custom skills** are markdown files you write that Claude can invoke automatically *or* you can invoke explicitly with `/<name>`.

A skill is just:

```
.claude/skills/<name>/SKILL.md
```

```markdown
---
name: deploy-staging
description: Use when the user wants to deploy the current branch to staging. Runs build, smoke test, and pushes to the staging tag.
allowed-tools: Bash(git:*), Bash(npm run build), Bash(npm run smoke)
---

1. Verify current branch is not `main`.
2. Run `npm run build` and report any failures, abort on failure.
3. Run `npm run smoke` and report failures, abort on failure.
4. Tag HEAD as `staging-$(date +%Y%m%d-%H%M%S)` and `git push origin <tag>`.
5. Print the tag and the staging URL.
```

The `description` is what makes Claude invoke it automatically — write it like a search query, not like prose.

### Project skills vs. user skills vs. plugin skills

| Where | Path | Sharing |
|---|---|---|
| **Project** | `<repo>/.claude/skills/<name>/SKILL.md` | Lives with the repo. Commit it. |
| **User** | `~/.claude/skills/<name>/SKILL.md` | Just for you, every project. |
| **Plugin** | Inside an installed plugin | Shared via marketplace, namespaced as `/plugin:skill`. |

Reference: [Skills docs](https://docs.claude.com/en/docs/claude-code/skills) · [Slash commands](https://docs.claude.com/en/docs/claude-code/slash-commands)

---

## 7. Subagents as a team

Subagents are isolated Claude instances dispatched by the main session. They have their own context window, their own tool restrictions, and their own system prompt. Think "team members," not "function calls."

### Why use them

- **Context hygiene.** A research subagent can read 30 files and return a 200-word summary. The main session never sees the noise.
- **Parallelism.** Multiple subagents in one tool-call block run concurrently. A 10-minute audit becomes 90 seconds.
- **Specialization.** A `code-reviewer` subagent with a sharper system prompt and tighter tool list catches things the generalist misses.
- **Independence.** A subagent reviewing your code hasn't seen your reasoning, so it gives a real second opinion.

### Defining a subagent

```
.claude/agents/integration-reviewer/agent.md
```

```markdown
---
name: integration-reviewer
description: Reviews integration changes (API + DB + cache) for race conditions, transaction boundaries, and migration safety. Use when changes touch more than one of those layers.
model: claude-opus-latest
tools: [Read, Grep, Glob, Bash(git diff:*)]
---

You are an integration reviewer. Read the diff and the surrounding code.
Report only:
1. Concrete race conditions, with file:line.
2. Transaction boundary errors.
3. Migration ordering risks.

No nits. No style notes. Confidence threshold: ≥80%.
```

### Dispatching them as a team

When you have N independent investigations, send them in **a single tool-call block** so they run in parallel:

```text
"Audit the user-onboarding flow."
  → Agent #1: trace the API route → DB calls
  → Agent #2: scan for missing input validation
  → Agent #3: check the test coverage map
  → Agent #4: review error-handling completeness
```

Each returns a focused report. Main session synthesizes. The pattern is in the [`superpowers:dispatching-parallel-agents`](https://github.com/anthropics/anthropic-skills) skill — install it once and use it everywhere.

### Global vs. project subagents

- **`~/.claude/agents/`** — your toolbox: code reviewer, debugger, planner, architect. Available everywhere.
- **`<repo>/.claude/agents/`** — project specialists: a "migration reviewer" that knows your schema, a "design system enforcer" that knows your tokens. Commit them.

Pair this with IndyDevDan's [fork-repository-skill](https://github.com/disler/fork-repository-skill) when you need *the same* agent forked N times to work on N branches simultaneously.

Reference: [Subagents docs](https://docs.claude.com/en/docs/claude-code/sub-agents)

---

## 8. The planning workflow

Three planning artifacts, three different jobs.

| Artifact | When | Persistence |
|---|---|---|
| **Plan mode** (Shift+Tab into `plan`) | "Walk me through what you'd do." | Lives in the conversation. |
| **TodoWrite list** | Multi-step task in the current session. | Lives in the conversation; cleared on exit. |
| **Written plan file** (`docs/plans/<feature>.md`) | Multi-session work, hand-off, review. | Survives across sessions and engineers. |

For anything more than half a day's work, write the plan to a file *before* you start. The [`superpowers:writing-plans`](https://github.com/anthropics/anthropic-skills) and `executing-plans` skills give you a clean ritual: write the plan in one session, execute it in another (often a fresh worktree), review at checkpoints.

Pair this with **git worktrees** ([`superpowers:using-git-worktrees`](https://github.com/anthropics/anthropic-skills)) when you want the executing session to work on an isolated copy of the repo — your main checkout stays usable while the agent grinds.

---

## 9. MCP servers: when, where, and at what scope

MCP (Model Context Protocol) servers add tools to Claude — Postgres queries, Sentry issues, Stripe lookups, Playwright automation, your internal API.

**Add an MCP server when:**
- You'd otherwise paste data from another system into the prompt repeatedly.
- The agent needs structured access (typed responses, not scraped HTML).
- You want stateful tools (browser sessions, REPLs).

**Don't add one when** a `Bash` command already does it. `gh pr view 123` doesn't need a GitHub MCP server.

### Configuration scopes

```
.mcp.json                  # project-shared (commit it)
~/.claude/.mcp.json        # user-level
```

Use `claude mcp add` for the interactive setup; it writes to the right file. Each server's tools appear in permissions as `mcp__<server>__<tool>` — grant them like any other tool.

Reference: [MCP docs](https://docs.claude.com/en/docs/claude-code/mcp)

---

## 10. Plugins and marketplaces

A plugin packages skills, agents, hooks, MCP configs, and settings into something installable. The `/plugin` command browses, installs, and updates them. Plugin commands are namespaced (`/plugin-name:command`), so they never collide with yours.

**Worth knowing:**
- The default Anthropic marketplace ships with the **superpowers** plugin (referenced repeatedly in this guide). Install it.
- You can run a plugin from disk with `--plugin-dir <path>` — that's how you develop your own.
- Plugin precedence: enterprise > user > project — useful for orgs that ship a base plugin everyone inherits.

To publish your own work, see Leland's [.claude_code](https://github.com/lelandg/.claude_code) and [ClaudeAgents](https://github.com/lelandg/ClaudeAgents) repos for shipping-shape examples, plus IndyDevDan's [the-library](https://github.com/disler/the-library) for the meta-skill of distributing skills across teams.

Reference: [Plugins](https://docs.claude.com/en/docs/claude-code/plugins) · [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces)

---

## 11. The Claude Agent SDK: when the CLI isn't enough

The CLI is for interactive sessions. The [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk) is for *programmatic* sessions — CI jobs, batch refactors, scheduled audits, your own custom apps.

It exposes the same primitives — tools, hooks, subagents, MCP, skills — through Python and TypeScript libraries. Your `.claude/` config (skills, `CLAUDE.md`, settings) loads the same way.

Repos:
- [claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python)
- [claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos)

Use it when you find yourself running the same `/loop` ritual every morning, or when you want a Slack bot that calls Claude with the same skills your terminal session uses.

---

## 12. The small things that compound

- **`/loop [interval] [prompt]`** — re-run a prompt on a schedule. Great for "watch this build" or "drain my PR queue every hour." Omit the interval and Claude paces itself.
- **`/schedule`** — one-off or recurring cloud agents (e.g., "open a cleanup PR for the feature flag in 2 weeks").
- **Output styles** — `default`, `explanatory`, `learning`, plus your own in `.claude/output-styles/`. Same capabilities, different voice.
- **Keybindings** — customize in `~/.claude/keybindings.json`. Rebind submit, add chord shortcuts. Use the [`keybindings-help`](https://docs.claude.com/en/docs/claude-code/keybindings) skill.
- **`/init`** — generates a starter `CLAUDE.md` by reading your repo. Run it on day 1 of any new project, then trim 50% of what it produced.
- **`/compact`** — summarize-then-truncate the conversation when context is getting heavy. Cheaper than starting over.
- **Auto memory** (`~/.claude/projects/<project>/memory/`) — Claude maintains its own persistent notes about you, your preferences, and the project. Worth reading occasionally; you can edit or delete entries.

---

## 13. Workflow patterns worth stealing

These are the repeatable rituals that turn Claude Code from "AI helper" into "force multiplier."

### TDD loop
Skill: [`superpowers:test-driven-development`](https://github.com/anthropics/anthropic-skills). Write the failing test first, then ask Claude to make it pass. Cuts hallucinated APIs almost to zero.

### Systematic debugging
Skill: [`superpowers:systematic-debugging`](https://github.com/anthropics/anthropic-skills). Forces hypothesis-driven investigation instead of "try things until it works." Use it on every bug that takes longer than 10 minutes.

### Brainstorming before building
Skill: [`superpowers:brainstorming`](https://github.com/anthropics/anthropic-skills). Mandatory before features. Surfaces assumptions and edge cases you'd otherwise hit at PR review.

### Verification before completion
Skill: [`superpowers:verification-before-completion`](https://github.com/anthropics/anthropic-skills). Forces "show me the passing test output" before claiming "done." Cures false-success rot.

### Code review by subagent
Use [`feature-dev:code-reviewer`](https://github.com/anthropics/anthropic-skills) or your own custom reviewer subagent on every meaningful change. They haven't seen your reasoning — they catch what you missed.

### Receiving code review
Skill: [`superpowers:receiving-code-review`](https://github.com/anthropics/anthropic-skills). Stops Claude from sycophantically agreeing with every reviewer comment. Forces verification before changes.

### Infinite agentic loop
IndyDevDan's [infinite-agentic-loop](https://github.com/disler/infinite-agentic-loop): two prompts, one generator, one critic, looping. Useful for design exploration and content generation tasks where you want N variations evaluated.

---

## 14. The starter checklist

If you're setting up a new machine or a new repo:

1. Install Claude Code, run `/init` in your repo, trim the generated `CLAUDE.md` by half.
2. Drop a minimal `~/.claude/settings.json` with your preferred model, output style, and a small allow-list of read-only commands.
3. Install the **superpowers** plugin from the default marketplace.
4. Add a `PostToolUse` hook for `Edit|Write` that runs your formatter and typechecker.
5. Add a `PreToolUse` hook that hard-blocks `git push --force` and `rm -rf`.
6. Add 2–3 specialist subagents to `~/.claude/agents/` — at minimum a code reviewer, a debugger, and an explorer.
7. For shared projects, commit `<repo>/.claude/settings.json`, `<repo>/CLAUDE.md`, and any project-specific skills under `<repo>/.claude/skills/`.
8. Run `/fewer-permission-prompts` after a week to mine your transcripts and tighten the allow-list.

You're now operating Claude Code, not just chatting with it.

---

## 15. Resource library

### Official Anthropic
- [Claude Code overview & docs hub](https://docs.claude.com/en/docs/claude-code/overview)
- [CLI reference](https://docs.claude.com/en/docs/claude-code/cli-reference)
- [Settings](https://docs.claude.com/en/docs/claude-code/settings)
- [Permissions / IAM](https://docs.claude.com/en/docs/claude-code/iam)
- [Hooks](https://docs.claude.com/en/docs/claude-code/hooks) · [Hooks guide](https://docs.claude.com/en/docs/claude-code/hooks-guide)
- [Slash commands](https://docs.claude.com/en/docs/claude-code/slash-commands)
- [Skills](https://docs.claude.com/en/docs/claude-code/skills)
- [Subagents](https://docs.claude.com/en/docs/claude-code/sub-agents)
- [MCP](https://docs.claude.com/en/docs/claude-code/mcp)
- [Plugins](https://docs.claude.com/en/docs/claude-code/plugins) · [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces)
- [Memory (CLAUDE.md)](https://docs.claude.com/en/docs/claude-code/memory)
- [Output styles](https://docs.claude.com/en/docs/claude-code/output-styles)
- [VS Code](https://docs.claude.com/en/docs/claude-code/vs-code) · [JetBrains](https://docs.claude.com/en/docs/claude-code/jetbrains)
- [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk)

### Official repositories
- [anthropics/claude-code](https://github.com/anthropics/claude-code) — the CLI
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python)
- [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [anthropics/claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos)
- [anthropics/anthropic-skills](https://github.com/anthropics/anthropic-skills) — the superpowers stack and friends
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) — MCP server registry

### IndyDevDan ([@indydevdan](https://www.youtube.com/@indydevdan) on YouTube · [`disler`](https://github.com/disler) on GitHub)
- [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) — best non-official hooks reference
- [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — see your hook events in real time
- [claude-code-is-programmable](https://github.com/disler/claude-code-is-programmable) — Claude Code as a scripting target
- [infinite-agentic-loop](https://github.com/disler/infinite-agentic-loop) — generator/critic pattern
- [the-library](https://github.com/disler/the-library) — distributing skills across teams
- [fork-repository-skill](https://github.com/disler/fork-repository-skill) — N-fork an agent across N branches
- [agentic-drop-zones](https://github.com/disler/agentic-drop-zones) — file-watching agentic patterns
- [just-prompt](https://github.com/disler/just-prompt) — multi-provider MCP server

### Leland Green ([@lelandg](https://github.com/lelandg) · [Chameleon Labs, LLC](https://github.com/Chameleon-Labs-LLC) · [lelandgreen.com](http://lelandgreen.com))
- [Chameleon-Labs-LLC/ClaudeCodeDashboard](https://github.com/Chameleon-Labs-LLC/ClaudeCodeDashboard) — local GUI dashboard for Claude Code (this repo)
- [lelandg/.claude_code](https://github.com/lelandg/.claude_code) — Leland's working Claude Code config and skills
- [lelandg/ClaudeAgents](https://github.com/lelandg/ClaudeAgents) — agents built for Claude Code
- [lelandg/ImageAI](https://github.com/lelandg/ImageAI) — image/video generator built end-to-end with Claude Code
- [lelandg/Codex-CLI-Helpers](https://github.com/lelandg/Codex-CLI-Helpers) — sibling tips for the OpenAI Codex CLI

---

*Last updated: April 2026. If a docs link 404s, the canonical entry point is [docs.claude.com/en/docs/claude-code](https://docs.claude.com/en/docs/claude-code/overview).*
