#!/usr/bin/env tsx
/**
 * scripts/setup-otel.ts
 *
 * Interactive Node CLI wizard that configures ~/.claude/settings.json with
 * the required OTEL environment variables so Claude Code sends telemetry to
 * the local dashboard (http://localhost:3000).
 *
 * Rules:
 *   - NEVER overwrites existing user values.
 *   - Always backs up settings.json before writing.
 *   - Merges only missing keys.
 *   - Works on Windows, macOS, and Linux.
 *   - No Next.js imports - runs before the dev server starts.
 *
 * Usage:
 *   npm run setup:otel
 *   npm run setup:otel -- --yes     (non-interactive, accept all)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

// Configuration

const REQUIRED_ENV: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY:   '1',
  OTEL_EXPORTER_OTLP_ENDPOINT:    'http://localhost:3000',
  OTEL_EXPORTER_OTLP_PROTOCOL:    'http/json',
  OTEL_METRICS_EXPORTER:          'otlp',
  OTEL_LOGS_EXPORTER:             'otlp',
  OTEL_LOG_TOOL_DETAILS:          '1',
};

// Paths

function getClaudeHome(): string {
  return process.env['CLAUDE_HOME'] ?? path.join(os.homedir(), '.claude');
}

function getSettingsPath(): string {
  return path.join(getClaudeHome(), 'settings.json');
}

// File I/O

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!fs.existsSync(settingsPath)) {
    console.log(`  settings.json not found - will create it at:\n  ${settingsPath}`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    console.error(`  ERROR: Could not parse settings.json: ${(err as Error).message}`);
    process.exit(1);
  }
}

function backupSettings(settingsPath: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19); // YYYY-MM-DD-HH-MM-SS
  // Reformat to YYYYMMDD-HHMMSS by removing dashes from date part
  const compact = ts.replace(/-/g, '').replace(/(\d{8})(\d{6})/, '$1-$2');
  const backupPath = `${settingsPath}.bak.${compact}`;
  fs.copyFileSync(settingsPath, backupPath);
  return backupPath;
}

function ensureClaudeHomeDir(settingsPath: string): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created directory: ${dir}`);
  }
}

// Prompt helper

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Main

async function main(): Promise<void> {
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');

  console.log('\n========================================================');
  console.log('   Claude Code Dashboard - OTEL Setup Wizard');
  console.log('========================================================\n');

  const settingsPath = getSettingsPath();
  console.log(`Settings file: ${settingsPath}\n`);

  const settings = readSettings(settingsPath);

  // Ensure env block exists as an object
  if (!settings['env'] || typeof settings['env'] !== 'object' || Array.isArray(settings['env'])) {
    settings['env'] = {};
  }
  const envBlock = settings['env'] as Record<string, string>;

  // Diff: find missing keys
  const missing: [string, string][] = [];
  const present: [string, string][] = [];

  for (const [key, desiredValue] of Object.entries(REQUIRED_ENV)) {
    if (envBlock[key] !== undefined) {
      present.push([key, envBlock[key]]);
    } else {
      missing.push([key, desiredValue]);
    }
  }

  // Report current state
  if (present.length > 0) {
    console.log('Already configured (will NOT be changed):');
    for (const [k, v] of present) {
      console.log(`  [ok]  ${k}=${v}`);
    }
    console.log();
  }

  if (missing.length === 0) {
    console.log('All OTEL keys are already present. Nothing to do.\n');
    console.log('Reminder: quit and restart Claude Code to pick up any recent changes.\n');
    process.exit(0);
  }

  console.log('Keys to add:');
  for (const [k, v] of missing) {
    console.log(`  +   ${k}=${v}`);
  }
  console.log();

  // Confirm
  if (!autoYes) {
    const answer = await prompt('Apply these changes? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('\nAborted. No changes made.\n');
      process.exit(0);
    }
  }

  // Backup (only if the file already exists)
  if (fs.existsSync(settingsPath)) {
    const backupPath = backupSettings(settingsPath);
    console.log(`\nBacked up to: ${backupPath}`);
  } else {
    ensureClaudeHomeDir(settingsPath);
  }

  // Merge missing keys - NEVER touch existing values
  for (const [key, value] of missing) {
    envBlock[key] = value;
  }

  // Write back
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  console.log(`Written: ${settingsPath}`);

  console.log('\n========================================================');
  console.log('  DONE - Next step:');
  console.log('');
  console.log('  Quit Claude Code completely and restart it.');
  console.log('  (It reads env vars only at startup.)');
  console.log('');
  console.log('  Then open http://localhost:3000/dashboard/settings');
  console.log('  -> Telemetry tab to confirm events are flowing.');
  console.log('========================================================\n');
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
