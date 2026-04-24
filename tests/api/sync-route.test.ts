import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('POST /api/sync route module exposes POST and returns stats', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '.ccd-test-'));
  const projectsDir = path.join(home, 'projects', '-tmp-demo');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'session-paired.jsonl'),
    path.join(projectsDir, 'sess-paired-1.jsonl')
  );
  process.env.CLAUDE_HOME = home;
  process.env.CCD_DB_PATH = path.join(home, 'dashboard.db');

  const mod = await import('../../app/api/sync/route');
  assert.equal(typeof mod.POST, 'function');

  const res = await mod.POST();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stats.sessionsSynced, 1);
  assert.equal(res.status, 200);

  delete process.env.CLAUDE_HOME;
  delete process.env.CCD_DB_PATH;
  fs.rmSync(home, { recursive: true, force: true });
});
