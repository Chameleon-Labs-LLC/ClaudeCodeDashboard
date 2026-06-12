import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getClaudeHome } from '@/lib/claude-home';
import {
  PRIMARY_SOURCE_ID,
  PRIMARY_SOURCE_LABEL,
  collectStats,
  loadSources,
  resolveSourceRoot,
  saveSources,
  slugId,
  validateSourcePath,
  type SourceStats,
  type UsageSource,
} from '@/lib/usage-sources';

export const dynamic = 'force-dynamic';

export interface SourceView extends UsageSource {
  implicit: boolean;
  reachable: boolean;
  stats: SourceStats;
}

function withStats(source: UsageSource, implicit: boolean): SourceView {
  const root = resolveSourceRoot(source);
  let reachable = false;
  try {
    reachable = fs.statSync(path.join(root, 'projects')).isDirectory();
  } catch {
    /* unreachable */
  }
  return {
    ...source,
    implicit,
    reachable,
    stats: reachable
      ? collectStats(root)
      : { projectCount: 0, transcriptCount: 0, latestActivity: null },
  };
}

export async function GET() {
  try {
    const primary: UsageSource = {
      id: PRIMARY_SOURCE_ID,
      label: PRIMARY_SOURCE_LABEL,
      path: getClaudeHome(),
      enabled: true,
    };
    const sources = [withStats(primary, true), ...loadSources().map((s) => withStats(s, false))];
    return NextResponse.json({ sources });
  } catch (err) {
    console.error('GET /api/sources failed:', err);
    return NextResponse.json({ error: 'failed to list sources' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { label?: string; path?: string };
    const label = body.label?.trim();
    const sourcePath = body.path?.trim();
    if (!label || !sourcePath) {
      return NextResponse.json({ error: 'label and path are required' }, { status: 400 });
    }
    const existing = loadSources();
    const validation = validateSourcePath(sourcePath, existing);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }
    const source: UsageSource = {
      id: slugId(label, existing),
      label,
      path: sourcePath,
      enabled: true,
    };
    saveSources([...existing, source]);
    return NextResponse.json({ source: withStats(source, false) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/sources failed:', err);
    return NextResponse.json({ error: 'failed to add source' }, { status: 500 });
  }
}
