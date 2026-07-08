export interface NavItem {
  href: string;
  label: string;
  icon: string;
  helpSlug: string;
}

/** Single source of truth for dashboard navigation. The main sidebar and the
 *  help sidebar both render from this list, in this order. */
export const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: '⊞', helpSlug: 'overview' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: '◉', helpSlug: 'sessions' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◈', helpSlug: 'memory' },
  { href: '/dashboard/projects', label: 'Projects', icon: '◆', helpSlug: 'projects' },
  { href: '/dashboard/history', label: 'History', icon: '◷', helpSlug: 'history' },
  { href: '/dashboard/activity', label: 'Activity', icon: '⚡', helpSlug: 'activity' },
  { href: '/dashboard/usage', label: 'Usage & Cost', icon: '◐', helpSlug: 'usage' },
  { href: '/dashboard/sources', label: 'Sources', icon: '⛁', helpSlug: 'sources' },
  { href: '/dashboard/tools', label: 'Tool Analytics', icon: '⚙', helpSlug: 'tools' },
  { href: '/dashboard/observability', label: 'Observability', icon: '◎', helpSlug: 'observability' },
  { href: '/dashboard/claude-md', label: 'CLAUDE.md', icon: '◇', helpSlug: 'claude-md' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚑', helpSlug: 'settings' },
  { href: '/dashboard/file-history', label: 'File History', icon: '◫', helpSlug: 'file-history' },
  { href: '/dashboard/tasks', label: 'Mission Control', icon: '⌂', helpSlug: 'tasks' },
  { href: '/dashboard/search', label: 'Search', icon: '⌕', helpSlug: 'search' },
];

/** Longest-prefix match of a dashboard pathname (no query string) to its help
 *  topic. Falls back to Overview for unknown paths. */
export function helpTopicForPath(pathname: string): NavItem {
  let best: NavItem | undefined;
  for (const item of navItems) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ?? navItems[0];
}
