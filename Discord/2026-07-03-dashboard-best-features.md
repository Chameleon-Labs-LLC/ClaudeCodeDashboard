## **ClaudeCodeDashboard update: usage tracking got fast, and the README finally tells the truth** 📊

If you run Claude Code a lot, you eventually want to know what it's costing you. That's the dashboard's job, and this week the Usage page got a big upgrade.

**💰 Usage & Cost tracking** is the headline feature. Every token, every session, every project, priced per model with live rates. The numbers match ccusage exactly (we checked, down to 0.02%). It used to take about a minute to load on a big history. Now it's about one second, and that holds even after a restart. It can also pull usage from more than one machine (my Windows and WSL installs both feed one page), so you finally get the whole picture in one place.

The rest of the lineup:

- **Sessions & search** — browse every transcript, fuzzy-search across all of it
- **Observability** — live telemetry from Claude Code itself: tool latency, cache efficiency, MCP server costs, hook activity
- **Mission Control** — an autonomous task board with schedules, approvals, and a big red emergency stop (it kills every running task, and yes, I've used it)
- **CLAUDE.md editor & settings inspector** — see and edit your config without hunting through dotfiles

Also: the README now has full documentation. Every page, every env var, telemetry setup, and a whole section on running one checkout from both PowerShell and WSL (which is trickier than it sounds... ask me how I know 🤓).

Repo: https://github.com/Chameleon-Labs-LLC/ClaudeCodeDashboard

Have you been tracking your Claude Code spend at all? Curious what numbers people see.
