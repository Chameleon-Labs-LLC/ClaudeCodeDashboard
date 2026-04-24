// lib/observability-helpers.ts

/**
 * Convert a ?range= param to a local-date-string cutoff (YYYY-MM-DD).
 * Uses Intl to get local date — matches Phase 1's bucketing strategy.
 */
export function rangeToLocalDateCutoff(range: string | null): string {
  const now = new Date();
  const localDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);

  if (range === 'today') {
    return localDate(now);
  }
  if (range === '30d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return localDate(d);
  }
  // default: 7d
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  return localDate(d);
}

/**
 * Compute percentile from a pre-sorted ascending numeric array.
 * Returns null for empty arrays.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

/**
 * Parse mcp__<server>__<tool> tool_name into { server, tool } or null.
 */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const m = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}
