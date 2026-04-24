import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  getDb().prepare(
    `INSERT INTO system_state(key,value,updated_at) VALUES('emergency_stop','0',?)
     ON CONFLICT(key) DO UPDATE SET value='0', updated_at=excluded.updated_at`,
  ).run(new Date().toISOString());
  return NextResponse.json({ resumed: true });
}
