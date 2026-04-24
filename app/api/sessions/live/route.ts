import { NextResponse } from 'next/server';
import { listLiveSessions } from '@/lib/live-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sessions = await listLiveSessions();
  return NextResponse.json(sessions);
}
