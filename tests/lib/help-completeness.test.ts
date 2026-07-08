import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItems } from '../../components/layout/nav-items';
import { getHelpTopic } from '../../lib/help-content';

test('every nav item has a real help topic (title + non-stub body)', () => {
  for (const item of navItems) {
    const topic = getHelpTopic(item.helpSlug);
    assert.ok(topic, `missing content/help/${item.helpSlug}.md`);
    assert.ok(topic.title.length > 0, `${item.helpSlug}: empty title`);
    assert.ok(
      topic.body.trim().length > 300,
      `content/help/${item.helpSlug}.md is a stub (${topic.body.trim().length} chars)`,
    );
    assert.ok(
      topic.sections.length >= 2,
      `${item.helpSlug}: needs at least two ## sections for the TOC/paging`,
    );
  }
});
