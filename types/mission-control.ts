/**
 * Mission Control — TypeScript interfaces shared between API routes,
 * server-side helpers, and React components.
 *
 * SQLite booleans are stored as INTEGER 0|1 — keep the numeric type so
 * row round-trips don't lose fidelity.
 */

export type TaskStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export type ExecutionMode = 'classic' | 'stream';
export type QuadrantType = 'do' | 'schedule' | 'delegate' | 'archive';
export type RiskLevel = 'low' | 'medium' | 'high';
export type DecisionStatus = 'pending' | 'answered';
export type InboxDirection = 'agent_to_user' | 'user_to_agent';

export interface OpsTask {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigned_skill: string | null;
  model: string | null;
  execution_mode: ExecutionMode;
  scheduled_for: string | null;
  requires_approval: number;
  risk_level: RiskLevel | null;
  dry_run: number;
  quadrant: QuadrantType | null;
  approved_at: string | null;
  session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  output_summary: string | null;
  error_message: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  assigned_skill?: string;
  model?: string;
  execution_mode?: ExecutionMode;
  scheduled_for?: string;
  requires_approval?: boolean | number;
  risk_level?: RiskLevel;
  dry_run?: boolean | number;
  quadrant?: QuadrantType;
}

export interface OpsSchedule {
  id: number;
  name: string;
  cron_expression: string;
  task_title: string;
  task_description: string | null;
  assigned_skill: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}

export interface OpsDecision {
  id: number;
  task_id: number | null;
  session_id: string | null;
  prompt: string;
  answer: string | null;
  status: DecisionStatus;
  created_at: string;
  answered_at: string | null;
}

export interface OpsInboxItem {
  id: number;
  task_id: number | null;
  session_id: string | null;
  direction: InboxDirection;
  body: string;
  read: number;
  created_at: string;
}
