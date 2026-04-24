/** Bucket an ISO string or epoch-ms value into a YYYY-MM-DD day key
 *  using local-time (or an explicit IANA timezone). Mirrors the source
 *  spec's `DATE(timestamp, 'localtime')` so evening sessions don't leak
 *  into tomorrow's bucket.
 */
export function localDay(value: string | number | Date, tz?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const timeZone = tz ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA already yields YYYY-MM-DD, but we normalise defensively
  return fmt.format(d).slice(0, 10);
}
