import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../../lib/is-typing-target';

test('isTypingTarget flags form fields and editable regions', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget), true);
  assert.equal(
    isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    true,
  );
});

test('isTypingTarget ignores non-editable targets and null', () => {
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});
