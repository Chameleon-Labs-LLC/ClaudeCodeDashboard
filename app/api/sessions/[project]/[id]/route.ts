import { NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/claude-data';

export async function GET(
  _request: Request,
  { params }: { params: { project: string; id: string } }
) {
  const detail = await getSessionDetail(params.project, params.id);
  if (!detail) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
