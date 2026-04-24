import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getClaudeHome } from './claude-home';

export type DB = Database.Database;

let _singleton: DB | null = null;

/** Resolve the SQLite file path. Override via env for tests / custom installs. */
export function getDbPath(): string {
  if (process.env.CCD_DB_PATH) return process.env.CCD_DB_PATH;
  const dir = path.join(getClaudeHome(), 'ccd');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dashboard.db');
}

/** Full schema — every table named in the source spec's "Database schema"
 *  section. Phases 1–5 all map into this; no downstream migration needed.
 *  Phase 1 only POPULATES `sessions`, `tool_calls`, `token_usage`.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'ide',
  cwd TEXT,
  git_branch TEXT,
  model TEXT,
  started_at TEXT,
  ended_at TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  effective_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER,
  error_count INTEGER DEFAULT 0,
  rate_limit_hit INTEGER DEFAULT 0,
  stop_reason TEXT,
  title TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS token_usage (
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ide',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  PRIMARY KEY (date, model, source)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  session_id TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  tool_name TEXT,
  ts TEXT,
  duration_ms INTEGER,
  error TEXT,
  PRIMARY KEY (session_id, tool_use_id)
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name_ts ON tool_calls(tool_name, ts);

CREATE TABLE IF NOT EXISTS otel_events (
  event_name TEXT,
  session_id TEXT,
  prompt_id TEXT,
  timestamp TEXT,
  model TEXT,
  tool_name TEXT,
  tool_success INTEGER,
  tool_duration_ms INTEGER,
  tool_error TEXT,
  cost_usd REAL,
  api_duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_create_tokens INTEGER,
  speed TEXT,
  error_message TEXT,
  status_code INTEGER,
  attempt_count INTEGER,
  skill_name TEXT,
  skill_source TEXT,
  prompt_length INTEGER,
  decision TEXT,
  decision_source TEXT,
  request_id TEXT,
  tool_result_size_bytes INTEGER,
  mcp_server_scope TEXT,
  plugin_name TEXT,
  plugin_version TEXT,
  marketplace_name TEXT,
  install_trigger TEXT,
  mcp_server_name TEXT,
  mcp_tool_name TEXT,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_otel_events_ts ON otel_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_otel_events_name_ts ON otel_events(event_name, timestamp);

CREATE TABLE IF NOT EXISTS otel_metrics (
  metric_name TEXT,
  metric_type TEXT,
  value REAL,
  session_id TEXT,
  model TEXT,
  timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_otel_metrics_name_ts ON otel_metrics(metric_name, timestamp);

CREATE TABLE IF NOT EXISTS ops_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  assigned_skill TEXT,
  model TEXT,
  execution_mode TEXT,
  scheduled_for TEXT,
  requires_approval INTEGER DEFAULT 0,
  risk_level TEXT,
  dry_run INTEGER DEFAULT 0,
  quadrant TEXT,
  approved_at TEXT,
  session_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  cost_usd REAL,
  output_summary TEXT,
  error_message TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  task_title TEXT,
  task_description TEXT,
  assigned_skill TEXT,
  enabled INTEGER DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ops_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  prompt TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_decisions_session_prompt
  ON ops_decisions(session_id, prompt)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  session_id TEXT,
  direction TEXT NOT NULL,
  body TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  detail TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_type_ts ON activities(event_type, created_at);

CREATE TABLE IF NOT EXISTS live_session_state (
  session_id TEXT PRIMARY KEY,
  state TEXT,
  current_tool TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_stats (
  server TEXT PRIMARY KEY,
  tools INTEGER,
  total_tokens INTEGER,
  error TEXT,
  measured_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_schemas (
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  schema_json TEXT,
  tokens INTEGER,
  collected_at TEXT,
  PRIMARY KEY (server, tool)
);

CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  environment TEXT,
  description TEXT,
  path TEXT,
  autonomy_level TEXT,
  user_invocable INTEGER DEFAULT 0,
  script_count INTEGER DEFAULT 0,
  last_modified TEXT
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  sent_at TEXT,
  chat_id TEXT,
  telegram_message_id TEXT,
  snoozed_until TEXT,
  UNIQUE(event_type, event_key, chat_id)
);
`;

export function openDb(dbPath?: string): DB {
  const p = dbPath ?? getDbPath();
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Process-wide singleton (production use). Tests should call `openDb(path)` directly. */
export function getDb(): DB {
  if (!_singleton) _singleton = openDb();
  return _singleton;
}

/** Idempotent "ADD COLUMN IF NOT EXISTS" helper.
 *  SQLite doesn't support IF NOT EXISTS on ADD COLUMN; we check pragma first.
 */
export function _migrateAddColumn(db: DB, table: string, col: string, type: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (info.some(c => c.name === col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
