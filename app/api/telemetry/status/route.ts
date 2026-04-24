import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getClaudeHome } from '@/lib/claude-home';
import { getDb } from '@/lib/db';
import type { TelemetryStatus } from '@/types/otel';

const REQUIRED_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_LOG_TOOL_DETAILS',
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

export async function GET(): Promise<NextResponse<TelemetryStatus>> {
  // Read ~/.claude/settings.json env block
  const settingsPath = path.join(getClaudeHome(), 'settings.json');
  let envBlock: Record<string, string> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['env'] && typeof parsed['env'] === 'object' && !Array.isArray(parsed['env'])) {
      envBlock = parsed['env'] as Record<string, string>;
    }
  } catch {
    // settings.json absent or unreadable - all keys missing
  }

  const keys = {} as TelemetryStatus['keys'];
  for (const k of REQUIRED_KEYS) {
    const val = envBlock[k];
    keys[k as RequiredKey] = {
      present: val !== undefined,
      value: val ?? null,
    };
  }

  // Query last event timestamp and total count
  let lastEventAt: string | null = null;
  let totalEvents = 0;
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT MAX(received_at) AS last_at, COUNT(*) AS cnt FROM otel_events`
    ).get() as { last_at: string | null; cnt: number } | undefined;
    if (row) {
      lastEventAt = row.last_at;
      totalEvents = row.cnt;
    }
  } catch {
    // DB not yet initialized - return zeros
  }

  return NextResponse.json({ keys, lastEventAt, totalEvents });
}
