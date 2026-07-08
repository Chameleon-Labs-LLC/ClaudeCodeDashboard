import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { slugify } from '../../lib/slugify';
import { getHelpTopic } from '../../lib/help-content';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'help');

test('slugify produces github-style anchors', () => {
  assert.equal(slugify('First Section'), 'first-section');
  assert.equal(slugify("Why is there an 'unknown' model?"), 'why-is-there-an-unknown-model');
  assert.equal(slugify('Second — Section!'), 'second-section');
});

test('getHelpTopic parses frontmatter title and body', () => {
  const topic = getHelpTopic('sample', FIXTURES);
  assert.ok(topic);
  assert.equal(topic.title, 'Sample Topic');
  assert.ok(topic.body.includes('Intro paragraph.'));
  assert.ok(!topic.body.includes('title:'), 'frontmatter must be stripped from body');
});

test('getHelpTopic extracts ## sections with anchor ids', () => {
  const topic = getHelpTopic('sample', FIXTURES);
  assert.ok(topic);
  assert.deepEqual(topic.sections, [
    { id: 'first-section', text: 'First Section' },
    { id: 'second-section', text: 'Second — Section!' },
  ]);
});

test('getHelpTopic returns null for a missing file', () => {
  assert.equal(getHelpTopic('does-not-exist', FIXTURES), null);
});

test('getHelpTopic rejects path-traversal slugs', () => {
  assert.equal(getHelpTopic('../secrets', FIXTURES), null);
  assert.equal(getHelpTopic('a/b', FIXTURES), null);
});
