'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { helpTopicForPath } from '@/components/layout/nav-items';
import { HELP_RETURN_KEY } from './help-return';

export default function HelpButton() {
  const router = useRouter();

  const openHelp = useCallback(() => {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem(HELP_RETURN_KEY, origin);
    router.push(`/help/${helpTopicForPath(window.location.pathname).helpSlug}`);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      openHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openHelp]);

  return (
    <button
      onClick={openHelp}
      aria-label="Open help for this page"
      title="Help (?)"
      className="fixed top-5 right-6 z-50 w-9 h-9 rounded-full border border-brand-cyan/30 bg-brand-navy-dark/80 text-brand-cyan text-lg font-bold backdrop-blur hover:bg-brand-cyan/10 hover:border-brand-cyan/60 transition-colors"
    >
      ?
    </button>
  );
}
