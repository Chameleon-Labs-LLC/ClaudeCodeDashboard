import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listLiveSessions,
  deriveStateFromJsonl,
  readNewLines,
} from '../lib/live-sessions';

let tmpHome: string;
let projectsDir: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccd-live-'));
  projectsDir = path.join(tmpHome, 'projects');
  await fs.mkdir(projectsDir, { recursive: true });
  process.env.CLAUDE_HOME = tmpHome;
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME;
});

async function writeSession(project: string, id: string, lines: object[], mtimeMs?: number) {
  const dir = path.join(projectsDir, project);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${id}.jsonl`);
  await fs.writeFile(fp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeMs !== undefined) {
    const t = new Date(mtimeMs);
    await fs.utimes(fp, t, t);
  }
  return fp;
}

describe('listLiveSessions', () => {
  it('returns sessions modified in the last 5 minutes', async () => {
    const now = Date.now();
    await writeSession('my-proj', 'sess-fresh', [
      { type: 'user', message: { content: 'hello world' }, timestamp: new Date(now).toISOString() }
    ], now - 60_000);
    await writeSession('my-proj', 'sess-stale', [
      { type: 'user', message: { content: 'old' }, timestamp: new Date(now - 10 * 60_000).toISOString() }
    ], now - 10 * 60_000);

    const rows = await listLiveSessions();
    expect(rows.map(r => r.id)).toEqual(['sess-fresh']);
    expect(rows[0].title).toContain('hello');
  });

  it('truncates title to 120 chars', async () => {
    const long = 'x'.repeat(500);
    await writeSession('p', 's1', [
      { type: 'user', message: { content: long } }
    ], Date.now());
    const rows = await listLiveSessions();
    expect(rows[0].title.length).toBeLessThanOrEqual(120);
  });

  it('returns empty array when projects dir missing', async () => {
    await fs.rm(projectsDir, { recursive: true });
    const rows = await listLiveSessions();
    expect(rows).toEqual([]);
  });
});

describe('deriveStateFromJsonl', () => {
  it('extracts cwd + model + title from the last meaningful line', async () => {
    const fp = await writeSession('p', 's1', [
      { type: 'user', message: { content: 'first thing' }, cwd: '/tmp/x', model: 'claude-opus-4-5' },
      { type: 'assistant', message: { content: 'reply' }, cwd: '/tmp/x', model: 'claude-opus-4-5' },
    ]);
    const state = await deriveStateFromJsonl(fp, 's1');
    expect(state.cwd).toBe('/tmp/x');
    expect(state.model).toBe('claude-opus-4-5');
    expect(state.title).toContain('first thing');
    expect(state.derivedFrom).toBe('jsonl');
  });

  it('returns none state for a missing file', async () => {
    const state = await deriveStateFromJsonl(path.join(projectsDir, 'nope.jsonl'), 'nope');
    expect(state.derivedFrom).toBe('none');
    expect(state.status).toBe('unknown');
  });
});

describe('readNewLines', () => {
  it('returns all lines on first read with offset 0', async () => {
    const fp = await writeSession('p', 's1', [
      { type: 'user', message: { content: 'a' } },
      { type: 'user', message: { content: 'b' } },
    ]);
    const { lines, newOffset } = await readNewLines(fp, 0);
    expect(lines.length).toBe(2);
    expect(newOffset).toBeGreaterThan(0);
  });

  it('returns only new lines on subsequent reads', async () => {
    const fp = await writeSession('p', 's1', [
      { type: 'user', message: { content: 'a' } },
    ]);
    const { newOffset } = await readNewLines(fp, 0);
    await fs.appendFile(fp, JSON.stringify({ type: 'user', message: { content: 'b' } }) + '\n');
    const { lines } = await readNewLines(fp, newOffset);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).message.content).toBe('b');
  });

  it('tolerates a trailing partial line', async () => {
    const fp = await writeSession('p', 's1', []);
    await fs.writeFile(fp, '{"type":"user","message":{"content":"partial no newline"');
    const { lines } = await readNewLines(fp, 0);
    expect(lines).toEqual([]); // partial line held back
  });
});
