# ClaudeCodeDashboard

Local GUI dashboard for Claude Code — browse sessions, manage memory, search, and inspect usage

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with real values
npm run dev
```

## Tech Stack
- Next.js 14, TypeScript, Tailwind CSS
- NextAuth v5
- Prisma + PostgreSQL
- AWS Amplify

## Troubleshooting — `better-sqlite3` on Windows

`better-sqlite3` ships prebuilt binaries for Windows, macOS, and Linux. If
`npm install` fails with an MSBuild / node-gyp error on Windows (no prebuilt
match for your Node version), fall back to a source build:

```powershell
npm config set msvs_version 2022
# Only needed if Visual Studio Build Tools are not already installed:
# npm install --global windows-build-tools
npm rebuild better-sqlite3 --build-from-source
```

On macOS / Linux this should never be required.
