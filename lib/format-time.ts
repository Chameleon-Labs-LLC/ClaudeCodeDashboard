/**
 * Relative time formatters shared across Mission Control panels.
 *
 * `formatRelativeTime` = time in the past (e.g. "5m ago")
 * `formatFutureTime`   = time in the future (e.g. "in 3h")
 */

export function formatRelativeTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (isNaN(diff)) return '—';
  if (diff < 0) return 'just now'; // clock skew — clamp instead of negatives
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatFutureTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = new Date(ts).getTime() - Date.now();
  if (isNaN(diff)) return '—';
  if (diff < 0) return 'overdue';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
