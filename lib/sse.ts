// Shared Server-Sent Events helpers — encoding, heartbeats, standard headers.
// Every SSE route in the app uses these so the framing is uniform and
// reverse-proxy friendly.

const encoder = new TextEncoder();

export function sseEncode(data: unknown, eventName?: string): Uint8Array {
  const lines: string[] = [];
  if (eventName) lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push('', '');
  return encoder.encode(lines.join('\n'));
}

export function sseComment(text: string): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}

export const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};
