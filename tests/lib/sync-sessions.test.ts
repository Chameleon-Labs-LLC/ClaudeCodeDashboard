import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../lib/db';
import { syncSessions } from '../../lib/sync-sessions';

function scratchHome(): { home: string; projectsDir: string; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const projectsDir = path.join(home, 'projects', '-tmp-demo');
  fs.mkdirSync(projectsDir, { recursive: true });
  return {
    home,
    projectsDir,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

test('syncSessions pairs tool_use/tool_result, caps orphans, upserts totals', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  const dbPath = path.join(home, 'test.db');

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );

  const db = openDb(dbPath);
  const stats = syncSessions({ db });
  assert.equal(stats.sessionsSynced, 1);

  const sess = db.prepare("SELECT * FROM sessions WHERE session_id='sess-paired-1'").get() as any;
  assert.ok(sess, 'session row missing');
  assert.equal(sess.model, 'claude-sonnet-4-7');
  assert.equal(sess.input_tokens, 150);     // 100 + 50
  assert.equal(sess.output_tokens, 30);     // 20 + 10
  assert.equal(sess.cache_read_tokens, 5);
  assert.equal(sess.stop_reason, 'end_turn');
  assert.equal(sess.cwd, '/tmp/demo');
  assert.equal(sess.git_branch, 'main');
  assert.ok(sess.cost_usd > 0);

  const tools = db.prepare("SELECT * FROM tool_calls WHERE session_id='sess-paired-1' ORDER BY tool_use_id").all() as any[];
  assert.equal(tools.length, 2);
  const paired = tools.find(t => t.tool_use_id === 'toolu_01')!;
  assert.equal(paired.tool_name, 'Read');
  assert.equal(paired.duration_ms, 2500);   // 10:00:03.500 − 10:00:01.000
  const orphan = tools.find(t => t.tool_use_id === 'toolu_02_orphan')!;
  assert.equal(orphan.duration_ms, null, 'orphan must have null duration');

  db.close();
  delete process.env.CLAUDE_HOME;
  cleanup();
});

test('syncSessions skips files when mtime <= synced_at and session ended', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  const db = openDb(path.join(home, 'test.db'));

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );

  const first = syncSessions({ db });
  assert.equal(first.sessionsSynced, 1);

  const second = syncSessions({ db });
  assert.equal(second.sessionsSkipped, 1, 'second pass should skip unchanged file');
  assert.equal(second.sessionsSynced, 0);

  db.close();
  delete process.env.CLAUDE_HOME;
  cleanup();
});

test('syncSessions buckets evening-session tokens into local day (not UTC)', () => {
  const { home, projectsDir, cleanup } = scratchHome();
  process.env.CLAUDE_HOME = home;
  process.env.TZ = 'America/Los_Angeles';
  const db = openDb(path.join(home, 'test.db'));

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-evening.jsonl'),
    path.join(projectsDir, 'sess-evening-1.jsonl')
  );

  syncSessions({ db });

  const rows = db.prepare('SELECT * FROM token_usage').all() as any[];
  assert.equal(rows.length, 1);
  // UTC date is 2026-04-25, but local (Los_Angeles) date is 2026-04-24
  assert.equal(rows[0].date, '2026-04-24');
  assert.equal(rows[0].input_tokens, 200);
  assert.equal(rows[0].cache_read_tokens, 10);

  db.close();
  delete process.env.CLAUDE_HOME;
  delete process.env.TZ;
  cleanup();
});

test('syncSessions no-ops when ~/.claude/projects does not exist (fresh install)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  process.env.CLAUDE_HOME = home; // no projects/ dir inside
  const db = openDb(path.join(home, 'test.db'));

  const stats = syncSessions({ db });
  assert.equal(stats.sessionsSynced, 0);
  assert.equal(stats.sessionsSkipped, 0);

  db.close();
  delete process.env.CLAUDE_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});
