'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from '@/components/layout/nav-items';

export default function HelpSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-brand-navy-dark border-r border-chameleon-amber/30 flex flex-col min-h-screen shrink-0">
      <div className="p-5 border-b border-chameleon-amber/30">
        <h1 className="font-heading text-xl text-chameleon-amber">Help</h1>
        <p className="text-xs text-gray-500 mt-1">Claude Code Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const href = `/help/${item.helpSlug}`;
          const isActive = pathname === href;
          return (
            <Link
              key={item.helpSlug}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-chameleon-amber/10 text-chameleon-amber border border-chameleon-amber/20'
                  : 'text-gray-400 hover:text-white hover:bg-brand-navy-light/50 border border-transparent'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-chameleon-amber/30 text-xs text-gray-600">
        <span className="text-gray-500">Press</span>{' '}
        <kbd className="px-1.5 py-0.5 bg-brand-navy-light rounded text-chameleon-amber text-[10px]">Esc</kbd>{' '}
        <span className="text-gray-500">to close help</span>
      </div>
    </aside>
  );
}
