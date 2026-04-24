import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeToLocalDateCutoff,
  percentile,
  parseMcpToolName,
} from '../../lib/observability-helpers';

test('rangeToLocalDateCutoff returns a YYYY-MM-DD string for each range', () => {
  const today = rangeToLocalDateCutoff('today');
  const seven = rangeToLocalDateCutoff('7d');
  const thirty = rangeToLocalDateCutoff('30d');
  const defaulted = rangeToLocalDateCutoff(null);

  for (const v of [today, seven, thirty, defaulted]) {
    assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `value "${v}" did not match YYYY-MM-DD`);
  }
});

test('rangeToLocalDateCutoff: 30d cutoff is older than (or equal to) 7d cutoff; both are older than or equal to today', () => {
  const today = rangeToLocalDateCutoff('today');
  const seven = rangeToLocalDateCutoff('7d');
  const thirty = rangeToLocalDateCutoff('30d');

  assert.ok(thirty <= seven, `30d (${thirty}) should be <= 7d (${seven})`);
  assert.ok(seven <= today, `7d (${seven}) should be <= today (${today})`);
});

test('rangeToLocalDateCutoff: default (no range) equals 7d', () => {
  const defaulted = rangeToLocalDateCutoff(null);
  const seven = rangeToLocalDateCutoff('7d');
  assert.equal(defaulted, seven);
});

test('percentile: returns null for empty arrays', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([], 95), null);
});

test('percentile: p50 of [10,20,30,40,50] = 30', () => {
  // ceil(0.5 * 5) - 1 = 2 → index 2 → 30
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
});

test('percentile: p95 of [1..100] = 95', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i + 1);
  // ceil(0.95 * 100) - 1 = 94 → arr[94] = 95
  assert.equal(percentile(arr, 95), 95);
});

test('percentile: single-element array returns that element for any percentile', () => {
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([42], 99), 42);
});

test('parseMcpToolName: parses mcp__filesystem__read_file', () => {
  const out = parseMcpToolName('mcp__filesystem__read_file');
  assert.deepEqual(out, { server: 'filesystem', tool: 'read_file' });
});

test('parseMcpToolName: parses server with underscore via greedy capture', () => {
  const out = parseMcpToolName('mcp__google_calendar__list_events');
  assert.ok(out !== null);
  // Regex captures mcp__([^_]+(?:_[^_]+)*)__(.+) → server='google_calendar', tool='list_events'
  assert.equal(out!.server, 'google_calendar');
  assert.equal(out!.tool, 'list_events');
});

test('parseMcpToolName: returns null for non-mcp tools', () => {
  assert.equal(parseMcpToolName('Bash'), null);
  assert.equal(parseMcpToolName('Read'), null);
  assert.equal(parseMcpToolName('Edit'), null);
  assert.equal(parseMcpToolName(''), null);
});

test('parseMcpToolName: handles tool names containing double-underscores', () => {
  // tool portion is '.+' so double-underscores in tool portion are captured
  const out = parseMcpToolName('mcp__foo__bar__baz');
  assert.ok(out !== null);
  assert.equal(out!.server, 'foo');
  assert.equal(out!.tool, 'bar__baz');
});
