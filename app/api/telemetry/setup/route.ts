import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getClaudeHome } from '@/lib/claude-home';

const REQUIRED_ENV: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY:  '1',
  OTEL_EXPORTER_OTLP_ENDPOINT:   'http://localhost:3000',
  OTEL_EXPORTER_OTLP_PROTOCOL:   'http/json',
  OTEL_METRICS_EXPORTER:         'otlp',
  OTEL_LOGS_EXPORTER:            'otlp',
  OTEL_LOG_TOOL_DETAILS:         '1',
};

export async function POST(): Promise<NextResponse<{ message: string }>> {
  const settingsPath = path.join(getClaudeHome(), 'settings.json');

  let settings: Record<string, unknown> = {};
  let fileExisted = false;

  if (fs.existsSync(settingsPath)) {
    fileExisted = true;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: 'ERROR: Could not parse settings.json. Edit it manually.' });
    }
  } else {
    // Ensure the directory exists
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  if (!settings['env'] || typeof settings['env'] !== 'object' || Array.isArray(settings['env'])) {
    settings['env'] = {};
  }
  const envBlock = settings['env'] as Record<string, string>;

  const missing: string[] = [];
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    if (envBlock[key] === undefined) {
      envBlock[key] = value;
      missing.push(key);
    }
  }

  if (missing.length === 0) {
    return NextResponse.json({ message: 'All OTEL keys already present. Nothing changed.' });
  }

  // Back up
  if (fileExisted) {
    const ts = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 15);
    const backupPath = `${settingsPath}.bak.${ts}`;
    try {
      fs.copyFileSync(settingsPath, backupPath);
    } catch {
      // Non-fatal - proceed without backup
    }
  }

  // Write
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return NextResponse.json({ message: `ERROR writing settings.json: ${(err as Error).message}` });
  }

  const addedList = missing.join(', ');
  return NextResponse.json({
    message: `Added ${missing.length} key(s): ${addedList}. Quit and restart Claude Code to apply.`,
  });
}
