/** Bucket an ISO string or epoch-ms value into a YYYY-MM-DD day key
 *  using local-time (or an explicit IANA timezone). Mirrors the source
 *  spec's `DATE(timestamp, 'localtime')` so evening sessions don't leak
 *  into tomorrow's bucket.
 */
// Intl.DateTimeFormat construction is expensive (~65x slower than reuse over
// 17k calls); cache one formatter per resolved timezone. Timezone resolution
// itself still happens per call so a TZ env change is picked up immediately.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function localDay(value: string | number | Date, tz?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const timeZone = tz ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  // en-CA already yields YYYY-MM-DD, but we normalise defensively
  return fmt.format(d).slice(0, 10);
}
