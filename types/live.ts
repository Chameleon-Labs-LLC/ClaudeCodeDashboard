// Row returned by GET /api/sessions/live
export interface LiveSessionRow {
  id: string;
  projectName: string;
  title: string;          // last user message, truncated to 120 chars
  cwd: string | null;
  model: string | null;
  startedAt: string;      // ISO-8601
  lastActiveAt: string;   // ISO-8601 (the JSONL mtime)
  tokenTotal: number;     // summed input+output+cache across messages
}

// One-shot row returned by GET /api/sessions/live/:id/state
export interface LiveSessionState {
  sessionId: string;
  cwd: string | null;
  model: string | null;
  title: string | null;
  status: 'active' | 'idle' | 'unknown';
  lastEventAt: string | null;
  derivedFrom: 'live_session_state' | 'jsonl' | 'none';
}

// A single tool-call timeline entry streamed over SSE
export interface LiveTimelineEntry {
  kind: 'tool_use' | 'tool_result' | 'user_message' | 'assistant_message' | 'system';
  timestamp: string;
  toolName?: string;
  preview?: string;        // truncated to 240 chars
  durationMs?: number;
  success?: boolean;
}

// Envelope pushed over /api/firehose
export interface FirehoseEvent {
  eventName: string;
  sessionId: string | null;
  model: string | null;
  timestamp: string;
  receivedAt: string;
  toolName: string | null;
  durationMs: number | null;
  costUsd: number | null;
}
