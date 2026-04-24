import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('better-sqlite3 loads and opens in-memory db', () => {
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS n').get() as { n: number };
  assert.equal(row.n, 1);
  db.close();
});
