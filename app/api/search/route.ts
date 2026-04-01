import { NextResponse } from 'next/server';
import { listSessions, listMemories, listProjects } from '@/lib/claude-data';
import type { SearchResult } from '@/types/claude';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 });
  }

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  const [sessions, memories, projects] = await Promise.all([
    listSessions(),
    listMemories(),
    listProjects(),
  ]);

  // Search sessions
  for (const s of sessions) {
    const text = `${s.projectName} ${s.summary || ''}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        type: 'session',
        title: `Session in ${s.projectName}`,
        snippet: s.summary || '(no summary)',
        path: `/dashboard/sessions/${s.projectPath}/${s.id}`,
        score: text.indexOf(q) === 0 ? 1 : 0.5,
        timestamp: s.lastActiveAt,
      });
    }
  }

  // Search memory
  for (const m of memories) {
    const text = `${m.name} ${m.description} ${m.content}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        type: 'memory',
        title: m.name,
        snippet: m.description || m.content.slice(0, 150),
        path: `/dashboard/memory`,
        score: m.name.toLowerCase().includes(q) ? 1 : 0.5,
      });
    }
  }

  // Search projects
  for (const p of projects) {
    const text = `${p.name} ${p.path}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        type: 'project',
        title: p.name,
        snippet: p.path,
        path: `/dashboard/projects/${p.name}`,
        score: 1,
        timestamp: p.lastActive,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return NextResponse.json(results.slice(0, 50));
}
