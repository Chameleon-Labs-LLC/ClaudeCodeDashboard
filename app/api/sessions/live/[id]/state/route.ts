import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getClaudeHome } from '@/lib/claude-home';
import { getDb } from '@/lib/db';
import { deriveStateFromJsonl } from '@/lib/live-sessions';
import type { LiveSessionState } from '@/types/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Session IDs are UUID-ish — defensively restrict so we can't be tricked
// into traversing outside ~/.claude/projects.
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  // 1. try live_session_state (Phase 5 hook writes this).
  // Schema is (session_id, state, current_tool, updated_at) where `state` is
  // a JSON blob. Parse defensively and fall back to JSONL if missing/invalid.
  try {
    const row = getDb().prepare(
      `SELECT session_id, state, current_tool, updated_at
       FROM live_session_state WHERE session_id = ?`
    ).get(id) as {
      session_id: string; state: string | null;
      current_tool: string | null; updated_at: string | null;
    } | undefined;

    if (row) {
      let parsed: Record<string, unknown> = {};
      try { if (row.state) parsed = JSON.parse(row.state); } catch { /* keep defaults */ }
      const state: LiveSessionState = {
        sessionId: row.session_id,
        cwd: (parsed.cwd as string | null) ?? null,
        model: (parsed.model as string | null) ?? null,
        title: (parsed.title as string | null) ?? null,
        status: ((parsed.status as LiveSessionState['status']) ?? 'unknown'),
        lastEventAt: row.updated_at,
        derivedFrom: 'live_session_state',
      };
      return NextResponse.json(state);
    }
  } catch { /* table may be empty or missing in dev — fall through */ }

  // 2. fall back to scanning JSONL
  const projectsDir = path.join(getClaudeHome(), 'projects');
  const projects = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const candidate = path.join(projectsDir, p.name, `${id}.jsonl`);
    try { await fs.access(candidate); }
    catch { continue; }
    const state = await deriveStateFromJsonl(candidate, id);
    return NextResponse.json(state);
  }

  return NextResponse.json({
    sessionId: id, cwd: null, model: null, title: null,
    status: 'unknown', lastEventAt: null, derivedFrom: 'none',
  } satisfies LiveSessionState);
}
