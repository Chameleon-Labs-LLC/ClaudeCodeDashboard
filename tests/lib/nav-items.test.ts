import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItems, helpTopicForPath } from '../../components/layout/nav-items';

test('navItems has 15 entries with unique kebab-case help slugs', () => {
  assert.equal(navItems.length, 15);
  const slugs = navItems.map((n) => n.helpSlug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('exact page path maps to its topic', () => {
  assert.equal(helpTopicForPath('/dashboard/usage').helpSlug, 'usage');
});

test('nested path maps to its section topic, not overview', () => {
  assert.equal(helpTopicForPath('/dashboard/sessions/myproj/abc123').helpSlug, 'sessions');
});

test('dashboard root maps to overview', () => {
  assert.equal(helpTopicForPath('/dashboard').helpSlug, 'overview');
});

test('unknown path falls back to overview', () => {
  assert.equal(helpTopicForPath('/nowhere').helpSlug, 'overview');
});

test('prefix match requires a path-segment boundary', () => {
  // '/dashboard/sessionsX' must NOT match '/dashboard/sessions'
  assert.equal(helpTopicForPath('/dashboard/sessionsX').helpSlug, 'overview');
});

test('overview is the first nav item (helpTopicForPath fallback target)', () => {
  assert.equal(navItems[0].helpSlug, 'overview');
});

test('nav hrefs are unique', () => {
  const hrefs = navItems.map((n) => n.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
