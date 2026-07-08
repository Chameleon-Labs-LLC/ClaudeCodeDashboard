'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { helpTopicForPath } from '@/components/layout/nav-items';
import { HELP_RETURN_KEY } from './help-return';

export default function HelpBanner() {
  const router = useRouter();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(sessionStorage.getItem(HELP_RETURN_KEY));
  }, []);

  const close = useCallback(() => {
    router.push(origin ?? '/dashboard');
  }, [router, origin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const backLabel = helpTopicForPath((origin ?? '/dashboard').split('?')[0]).label;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-4 px-6 py-3 bg-chameleon-amber/10 border-b border-chameleon-amber/30 backdrop-blur">
      <div className="flex items-center gap-3 text-sm">
        <span className="px-2 py-0.5 rounded bg-chameleon-amber text-brand-navy-dark font-bold text-xs">
          ? HELP
        </span>
        <span className="text-gray-300">You&apos;re browsing Help</span>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={close} className="text-sm text-chameleon-amber hover:underline">
          ← Back to {backLabel}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Close help"
          className="w-7 h-7 rounded-lg border border-chameleon-amber/40 text-chameleon-amber hover:bg-chameleon-amber/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
