import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarker, type FenceState } from '../../lib/dispatcher';

test('parseMarker respects triple-backtick fences', () => {
  const state: FenceState = { inFencedBlock: false };
  const lines = [
    'Regular text before.',
    '',
    'DECISION: outside fence — must be parsed',
    '',
    '```typescript',
    'DECISION: inside fence — MUST NOT be parsed',
    'INBOX: inside fence — MUST NOT be parsed',
    '```',
    '',
    'INBOX: outside fence — must be parsed',
    '',
    'DECISION: after fence close — must be parsed',
  ];
  const markers = [];
  for (const l of lines) {
    const m = parseMarker(l, state);
    if (m) markers.push(m);
  }
  assert.equal(markers.length, 3, 'exactly 3 markers must be parsed');
  assert.equal(markers[0].type, 'decision');
  assert.equal(markers[0].payload, 'outside fence — must be parsed');
  assert.equal(markers[1].type, 'inbox');
  assert.equal(markers[1].payload, 'outside fence — must be parsed');
  assert.equal(markers[2].type, 'decision');
  assert.equal(markers[2].payload, 'after fence close — must be parsed');
});

test('parseMarker: fence state toggles on each triple-backtick line', () => {
  const state: FenceState = { inFencedBlock: false };
  assert.equal(parseMarker('```', state), null);
  assert.equal(state.inFencedBlock, true);
  assert.equal(parseMarker('```', state), null);
  assert.equal(state.inFencedBlock, false);
});

test('parseMarker: non-marker lines outside fences return null', () => {
  const state: FenceState = { inFencedBlock: false };
  assert.equal(parseMarker('Just prose', state), null);
  assert.equal(parseMarker('console.log("DECISION: foo")', state), null); // not at start
});
