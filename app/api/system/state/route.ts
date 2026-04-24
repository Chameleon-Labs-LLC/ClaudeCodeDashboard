import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT key, value FROM system_state`)
    .all() as { key: string; value: string }[];
  const state: Record<string, string> = {};
  for (const row of rows) state[row.key] = row.value;
  return NextResponse.json(state);
}
