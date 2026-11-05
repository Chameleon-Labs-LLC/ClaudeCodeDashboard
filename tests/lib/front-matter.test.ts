import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter } from '../../lib/front-matter';

test('parseFrontMatter reads YAML front matter', () => {
  const { data, content } = parseFrontMatter('---\nname: demo\ntype: user\n---\nbody text\n');
  assert.equal(data.name, 'demo');
  assert.equal(data.type, 'user');
  assert.equal(content.trim(), 'body text');
});

test('parseFrontMatter never evaluates JavaScript front matter', () => {
  const g = globalThis as Record<string, unknown>;
  delete g.__fmPwned;
  for (const fence of ['js', 'javascript', 'JS', 'JavaScript']) {
    const raw = `---${fence}\n{ name: (globalThis.__fmPwned = true, 'x') }\n---\nbody\n`;
    assert.throws(() => parseFrontMatter(raw), /not supported/, `fence ---${fence} must be refused`);
  }
  assert.equal(g.__fmPwned, undefined, 'front matter code must not run');
});
