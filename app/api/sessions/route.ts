import { NextResponse } from 'next/server';
import { listSessions } from '@/lib/claude-data';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project') || undefined;
  const sessions = await listSessions(project);
  return NextResponse.json(sessions);
}
