import { NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/claude-data';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string; id: string }> }
) {
  const { project, id } = await params;
  const detail = await getSessionDetail(project, id);
  if (!detail) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
