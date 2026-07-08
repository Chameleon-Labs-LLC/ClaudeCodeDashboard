import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItems } from '../../components/layout/nav-items';
import { getHelpTopic } from '../../lib/help-content';

test('help topic section anchor ids are unique within each topic', () => {
  for (const item of navItems) {
    const topic = getHelpTopic(item.helpSlug);
    assert.ok(topic, `missing content/help/${item.helpSlug}.md`);
    const ids = topic.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${item.helpSlug}: duplicate anchor id`);
  }
});

test('help topic ## headings are plain text so loader/renderer anchor ids stay in sync', () => {
  // The loader slugifies the raw markdown line; the renderer slugifies rendered
  // heading text. Inline markdown (code/link/emphasis) in a heading would desync
  // the two, breaking the TOC link. Keep headings plain, or extend both derivations.
  for (const item of navItems) {
    const topic = getHelpTopic(item.helpSlug);
    assert.ok(topic);
    for (const s of topic.sections) {
      assert.doesNotMatch(
        s.text,
        /[`*_[\]]/,
        `${item.helpSlug} heading "${s.text}" has inline markdown`,
      );
    }
  }
});
