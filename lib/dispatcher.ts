/**
 * dispatcher — spawn manager for Mission Control.
 *
 * Responsibilities:
 *  1. Honour the emergency_stop flag.
 *  2. Sweep stale PID files (liveness probe).
 *  3. Claim up to MAX_CONCURRENT pending tasks (atomically).
 *  4. Spawn `claude -p` children; track each by `.tmp/mission-control-queue/pids/{pid}`.
 *  5. In stream mode: parse stdout for DECISION:/INBOX: markers (fenced-block-aware)
 *     and propagate to /api/decisions and /api/inbox.
 *
 * PID files are the ONLY cross-platform mechanism for tracking dispatcher
 * children — an interactive `claude -p` started in another terminal has no
 * PID file and is therefore invisible to emergency stop.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import {
  claimPending,
  completeTask,
  failTask,
  updateTask,
} from './task-tracker';
import type { OpsTask } from '@/types/mission-control';

export const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT ?? '3', 10);
export const TASK_TIMEOUT_MS =
  parseInt(process.env.TASK_TIMEOUT_SECONDS ?? '300', 10) * 1000;
const DECISION_POLL_INTERVAL_MS = 2000;

export const QUEUE_DIR = path.join(
  process.cwd(),
  '.tmp',
  'mission-control-queue',
);
export const PID_DIR = path.join(QUEUE_DIR, 'pids');

const CLAUDE_BIN = process.env.CLAUDE_BINARY ?? 'claude';

function ensurePidDir(): void {
  fs.mkdirSync(PID_DIR, { recursive: true });
}

export function markPid(pid: number): void {
  ensurePidDir();
  fs.writeFileSync(path.join(PID_DIR, String(pid)), String(pid), 'utf-8');
}

export function unmarkPid(pid: number): void {
  try { fs.unlinkSync(path.join(PID_DIR, String(pid))); } catch { /* already gone */ }
}

export function sweepStalePids(): void {
  let files: string[];
  try { files = fs.readdirSync(PID_DIR); } catch { return; }
  for (const f of files) {
    const pid = parseInt(f, 10);
    if (isNaN(pid)) continue;
    // NOTE: `process.kill(pid, 0)` reliably throws ESRCH on Linux/macOS for
    // dead PIDs. On Windows it MAY NOT throw for dead PIDs in some Node
    // versions — the authoritative Windows liveness probe is
    // `tasklist /FI "PID eq <pid>"` (used by the emergency-stop route).
    try {
      process.kill(pid, 0); // throws for dead PIDs on Unix; best-effort on Windows
    } catch {
      try { fs.unlinkSync(path.join(PID_DIR, f)); } catch { /* race */ }
    }
  }
}

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:3000',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    ATOMICOPS_DISPATCHED: '1',
  };
}

function resolveModel(task: OpsTask): string {
  return (
    task.model ??
    process.env.MISSION_CONTROL_DEFAULT_MODEL ??
    'claude-sonnet-4-6'
  );
}

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

export interface FenceState { inFencedBlock: boolean }
export interface ParsedMarker { type: 'decision' | 'inbox'; payload: string }

/** Fenced-block-aware DECISION:/INBOX: parser.
 *
 *  Claude legitimately emits triple-backtick code blocks that may contain the
 *  substrings `DECISION:` or `INBOX:` as examples — those must NEVER trigger
 *  HITL actions. Use a shared mutable `state` across all calls within one
 *  logical stream so fences toggle correctly.
 */
export function parseMarker(line: string, state: FenceState): ParsedMarker | null {
  const trimmed = line.trim();

  if (trimmed.startsWith('```')) {
    state.inFencedBlock = !state.inFencedBlock;
    return null;
  }
  if (state.inFencedBlock) return null;

  if (trimmed.startsWith('DECISION:')) {
    return { type: 'decision', payload: trimmed.slice('DECISION:'.length).trim() };
  }
  if (trimmed.startsWith('INBOX:')) {
    return { type: 'inbox', payload: trimmed.slice('INBOX:'.length).trim() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line-buffered stdout reader
// ---------------------------------------------------------------------------

function makeLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  let buf = '';
  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
    buf = '';
  });
}

// ---------------------------------------------------------------------------
// Classic runner — fire-and-forget, no stdin injection
// ---------------------------------------------------------------------------

async function runClassic(task: OpsTask): Promise<void> {
  const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
  const model = resolveModel(task);
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (task.dry_run) args.push('--dry-run');

  const proc = spawn(CLAUDE_BIN, args, {
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pid = proc.pid!;
  markPid(pid);
  const startMs = Date.now();
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
  proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      failTask(task.id, `Timeout after ${TASK_TIMEOUT_MS}ms`, Date.now() - startMs);
      unmarkPid(pid);
      resolve();
    }, TASK_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      unmarkPid(pid);
      failTask(task.id, `Spawn error: ${err.message}`, Date.now() - startMs);
      resolve();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      unmarkPid(pid);
      const durationMs = Date.now() - startMs;
      if (code === 0) {
        completeTask(task.id, stdout.slice(0, 2000), durationMs);
      } else {
        failTask(task.id, stderr.slice(0, 500) || `Exit code ${code}`, durationMs);
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Stream runner — interactive, stdin available for HITL answer injection
// ---------------------------------------------------------------------------

function postHttp(urlPath: string, body: object): void {
  const baseUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { request } = require(baseUrl.startsWith('https') ? 'https' : 'http');
  const raw = JSON.stringify(body);
  const req = request(
    baseUrl + urlPath,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
      },
    },
    (_res: unknown) => { /* fire-and-forget */ },
  );
  req.on('error', () => { /* swallow — dashboard may be offline */ });
  req.write(raw);
  req.end();
}

async function runStream(task: OpsTask): Promise<void> {
  const prompt = [task.title, task.description].filter(Boolean).join('\n\n');
  const model = resolveModel(task);
  const args = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose',
  ];
  if (task.dry_run) args.push('--dry-run');

  const proc = spawn(CLAUDE_BIN, args, {
    env: buildEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pid = proc.pid!;
  markPid(pid);
  const startMs = Date.now();
  let sessionId: string | null = null;
  let lastQueueOffset = 0;
  const fenceState: FenceState = { inFencedBlock: false };
  let stderr = '';
  let done = false;

  proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  // Poll user follow-up queue and inject lines into stdin.
  const queuePoller = setInterval(() => {
    if (!sessionId) return;
    const queueFile = path.join(QUEUE_DIR, `${sessionId}.jsonl`);
    try {
      const size = fs.statSync(queueFile).size;
      if (size <= lastQueueOffset) return;
      const fd = fs.openSync(queueFile, 'r');
      const buf = Buffer.alloc(size - lastQueueOffset);
      fs.readSync(fd, buf, 0, buf.length, lastQueueOffset);
      fs.closeSync(fd);
      lastQueueOffset = size;
      for (const line of buf.toString('utf-8').split('\n')) {
        if (line.trim()) proc.stdin.write(line + '\n');
      }
    } catch { /* queue file not created yet */ }
  }, 2000);

  function handleDecision(decisionPrompt: string): void {
    const baseUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
    const payload = { task_id: task.id, session_id: sessionId, prompt: decisionPrompt };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { request } = require(baseUrl.startsWith('https') ? 'https' : 'http');
    const raw = JSON.stringify(payload);
    const req = request(
      baseUrl + '/api/decisions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(raw),
        },
      },
      (res: NodeJS.ReadableStream) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => {
          try {
            const { id: decisionId } = JSON.parse(data);
            if (typeof decisionId !== 'number') return;
            const deadline = Date.now() + TASK_TIMEOUT_MS;
            const poller = setInterval(() => {
              const row = getDb()
                .prepare(`SELECT answer FROM ops_decisions WHERE id=? AND status='answered'`)
                .get(decisionId) as { answer: string } | undefined;
              if (row) {
                clearInterval(poller);
                if (!done) proc.stdin.write(row.answer + '\n');
              } else if (Date.now() > deadline) {
                clearInterval(poller);
                if (!done) proc.kill('SIGTERM');
              }
            }, DECISION_POLL_INTERVAL_MS);
          } catch { /* malformed response */ }
        });
      },
    );
    req.on('error', () => { /* dashboard offline — skip this HITL turn */ });
    req.write(raw);
    req.end();
  }

  function handleInbox(message: string): void {
    postHttp('/api/inbox', {
      task_id: task.id,
      session_id: sessionId,
      direction: 'agent_to_user',
      body: message,
    });
  }

  makeLineReader(proc.stdout, (line) => {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
        sessionId = obj.session_id as string;
        updateTask(task.id, { session_id: sessionId });
      }
      if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content as Array<{ type: string; text?: string }>) {
          if (block.type === 'text' && block.text) {
            for (const textLine of block.text.split('\n')) {
              const marker = parseMarker(textLine, fenceState);
              if (marker?.type === 'decision') handleDecision(marker.payload);
              if (marker?.type === 'inbox') handleInbox(marker.payload);
            }
          }
        }
      }
    } catch { /* non-JSON lines ignored */ }
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      done = true;
      proc.kill('SIGTERM');
      clearInterval(queuePoller);
      failTask(task.id, `Timeout after ${TASK_TIMEOUT_MS}ms`, Date.now() - startMs);
      unmarkPid(pid);
      resolve();
    }, TASK_TIMEOUT_MS);

    proc.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(queuePoller);
      unmarkPid(pid);
      failTask(task.id, `Spawn error: ${err.message}`, Date.now() - startMs);
      resolve();
    });

    proc.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(queuePoller);
      unmarkPid(pid);
      const durationMs = Date.now() - startMs;
      if (code === 0) {
        completeTask(task.id, 'Stream session completed', durationMs);
      } else {
        failTask(task.id, stderr.slice(0, 500) || `Exit code ${code}`, durationMs);
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

export async function runOnce(): Promise<void> {
  const stopRow = getDb()
    .prepare(`SELECT value FROM system_state WHERE key='emergency_stop'`)
    .get() as { value: string } | undefined;

  if (stopRow?.value === '1') {
    // Log a heartbeat so we can confirm the tick ran but was throttled.
    getDb()
      .prepare(
        `INSERT INTO activities(event_type, detail, created_at) VALUES('heartbeat', ?, ?)`,
      )
      .run(JSON.stringify({ tasks_dispatched: 0, emergency_stop: true }), new Date().toISOString());
    return;
  }

  sweepStalePids();

  const pending = getDb()
    .prepare(
      `SELECT * FROM ops_tasks
       WHERE status='pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
    )
    .all(MAX_CONCURRENT) as OpsTask[];

  const runners: Promise<void>[] = [];

  for (const task of pending) {
    if (task.requires_approval && !task.approved_at) {
      getDb()
        .prepare(
          `UPDATE ops_tasks SET status='awaiting_approval'
           WHERE id=? AND status='pending'`,
        )
        .run(task.id);
      continue;
    }

    const claimed = claimPending(task.id);
    if (!claimed) continue; // another dispatcher instance took it

    const runner = (claimed.execution_mode === 'stream' ? runStream : runClassic)(claimed)
      .catch((err) => failTask(claimed.id, String(err)));
    runners.push(runner);
  }

  await Promise.all(runners);

  getDb()
    .prepare(
      `INSERT INTO activities(event_type, detail, created_at) VALUES('heartbeat', ?, ?)`,
    )
    .run(JSON.stringify({ tasks_dispatched: runners.length }), new Date().toISOString());
}
