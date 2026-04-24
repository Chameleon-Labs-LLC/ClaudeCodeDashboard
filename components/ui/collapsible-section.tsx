// components/ui/collapsible-section.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const STORAGE_PREFIX = 'cc:section:';

export default function CollapsibleSection({
  id, title, subtitle, defaultOpen = true, children,
}: CollapsibleSectionProps) {
  const storageKey = `${STORAGE_PREFIX}${id}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === 'true';
  });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, String(open));
  }, [open, storageKey]);

  // Height animation via max-height transition
  const contentStyle: React.CSSProperties = {
    overflow: 'hidden',
    maxHeight: open ? '9999px' : '0px',
    transition: 'max-height 220ms ease-out',
  };

  return (
    <section className="mb-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`section-content-${id}`}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left group mb-3"
      >
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform duration-220 ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-heading text-lg text-brand-cyan group-hover:text-brand-cyan/80 transition-colors">
          {title}
        </span>
        {subtitle && (
          <span className="text-xs text-gray-500 ml-2 font-mono uppercase tracking-widest">
            {subtitle}
          </span>
        )}
      </button>
      <div
        id={`section-content-${id}`}
        ref={contentRef}
        style={contentStyle}
      >
        {children}
      </div>
    </section>
  );
}
