'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '⊞' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: '◉' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◈' },
  { href: '/dashboard/projects', label: 'Projects', icon: '◆' },
  { href: '/dashboard/search', label: 'Search', icon: '⌕' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-brand-navy-dark border-r border-brand-navy-light/30 flex flex-col min-h-screen">
      <div className="p-6 border-b border-brand-navy-light/30">
        <h1 className="font-heading text-xl text-brand-cyan">Claude Code</h1>
        <p className="text-sm text-gray-400 mt-1">Dashboard</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20'
                  : 'text-gray-400 hover:text-white hover:bg-brand-navy-light/50'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-brand-navy-light/30 text-xs text-gray-500">
        ChameleonLabs
      </div>
    </aside>
  );
}
