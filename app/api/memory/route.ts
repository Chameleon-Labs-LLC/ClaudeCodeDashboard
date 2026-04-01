import { NextResponse } from 'next/server';
import { listMemories, getMemoryIndex } from '@/lib/claude-data';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project') || undefined;
  const indexOnly = searchParams.get('indexOnly') === 'true';

  if (indexOnly) {
    const index = await getMemoryIndex(project);
    return NextResponse.json(index);
  }

  const memories = await listMemories(project);
  return NextResponse.json(memories);
}
