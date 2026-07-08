/** True when a keyboard event targets a form field or editable region, so
 *  global single-key shortcuts ('/', '?') should not fire. Pure and DOM-free
 *  enough to unit-test with plain objects; safe for client imports. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
