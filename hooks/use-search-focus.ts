'use client';

import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/is-typing-target';

/**
 * Returns a ref to attach to a search input.
 * - Focuses the input on mount (when the pane opens).
 * - Focuses the input when '/' is pressed anywhere on the page.
 */
export function useSearchFocus<T extends HTMLInputElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    // Auto-focus on mount
    ref.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      // Skip if the user is typing in a form field or editable region
      if (isTypingTarget(e.target)) return;

      if (e.key === '/') {
        e.preventDefault();
        ref.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return ref;
}
