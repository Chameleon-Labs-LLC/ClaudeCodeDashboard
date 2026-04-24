import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../../lib/local-day';

test('localDay returns YYYY-MM-DD in the supplied timezone', () => {
  // 2026-04-24T23:30:00-04:00 → America/New_York → 2026-04-24
  assert.equal(localDay('2026-04-25T03:30:00.000Z', 'America/New_York'), '2026-04-24');
});

test('localDay handles evening sessions that cross UTC midnight', () => {
  // 2026-04-24T21:00:00-07:00 local = 2026-04-25T04:00:00Z
  // Local-time bucket must be 2026-04-24, NOT 2026-04-25
  assert.equal(localDay('2026-04-25T04:00:00.000Z', 'America/Los_Angeles'), '2026-04-24');
});

test('localDay accepts epoch millis', () => {
  // 2026-04-24T12:00:00Z → UTC → 2026-04-24
  const ms = Date.UTC(2026, 3, 24, 12, 0, 0);
  assert.equal(localDay(ms, 'UTC'), '2026-04-24');
});

test('localDay falls back to system tz when none supplied', () => {
  const out = localDay('2026-04-24T12:00:00.000Z');
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});
