'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '⊞' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: '◉' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◈' },
  { href: '/dashboard/projects', label: 'Projects', icon: '◆' },
  { href: '/dashboard/history', label: 'History', icon: '◷' },
  { href: '/dashboard/activity', label: 'Activity', icon: '⚡' },
  { href: '/dashboard/usage', label: 'Usage & Cost', icon: '◐' },
  { href: '/dashboard/tools', label: 'Tool Analytics', icon: '⚙' },
  { href: '/dashboard/observability', label: 'Observability', icon: '◎' },
  { href: '/dashboard/claude-md', label: 'CLAUDE.md', icon: '◇' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚑' },
  { href: '/dashboard/file-history', label: 'File History', icon: '◫' },
  { href: '/dashboard/tasks', label: 'Mission Control', icon: '⌂' },
  { href: '/dashboard/search', label: 'Search', icon: '⌕' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-brand-navy-dark border-r border-brand-navy-light/30 flex flex-col min-h-screen shrink-0">
      <div className="p-5 border-b border-brand-navy-light/30">
        <h1 className="font-heading text-xl text-brand-cyan">Claude Code</h1>
        <p className="text-xs text-gray-500 mt-1">Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20'
                  : 'text-gray-400 hover:text-white hover:bg-brand-navy-light/50 border border-transparent'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-brand-navy-light/30 text-xs text-gray-600">
        <span className="text-gray-500">Press</span>{' '}
        <kbd className="px-1.5 py-0.5 bg-brand-navy-light rounded text-brand-cyan text-[10px]">/</kbd>{' '}
        <span className="text-gray-500">to search</span>
      </div>
    </aside>
  );
}
