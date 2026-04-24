import { NextResponse } from 'next/server';
import { parseOtelLogs } from '@/lib/otel-parse';
import { getDb } from '@/lib/db';
import type { OtlpLogsPayload, IngestResponse } from '@/types/otel';

const INSERT_OTEL_EVENT = `
  INSERT INTO otel_events (
    event_name, session_id, prompt_id, timestamp, model,
    tool_name, tool_success, tool_duration_ms, tool_error,
    cost_usd, api_duration_ms, input_tokens, output_tokens,
    cache_read_tokens, cache_create_tokens, speed, error_message,
    status_code, attempt_count, skill_name, skill_source,
    prompt_length, decision, decision_source, request_id,
    tool_result_size_bytes, mcp_server_scope, plugin_name,
    plugin_version, marketplace_name, install_trigger,
    mcp_server_name, mcp_tool_name, received_at
  ) VALUES (
    @event_name, @session_id, @prompt_id, @timestamp, @model,
    @tool_name, @tool_success, @tool_duration_ms, @tool_error,
    @cost_usd, @api_duration_ms, @input_tokens, @output_tokens,
    @cache_read_tokens, @cache_create_tokens, @speed, @error_message,
    @status_code, @attempt_count, @skill_name, @skill_source,
    @prompt_length, @decision, @decision_source, @request_id,
    @tool_result_size_bytes, @mcp_server_scope, @plugin_name,
    @plugin_version, @marketplace_name, @install_trigger,
    @mcp_server_name, @mcp_tool_name, @received_at
  )
`;

export async function POST(request: Request): Promise<NextResponse<IngestResponse>> {
  let body: OtlpLogsPayload;
  try {
    body = (await request.json()) as OtlpLogsPayload;
  } catch {
    // Return 200 even on unparseable JSON - do not allow HTTP errors to
    // cause Claude Code to retry the batch (it does not retry on 200).
    console.error('[/v1/logs] Failed to parse request body as JSON');
    return NextResponse.json({ accepted: 0, dropped: 1 });
  }

  const { rows, dropped: parseDropped } = parseOtelLogs(body);

  let accepted = 0;
  let insertDropped = 0;

  try {
    const db = getDb();
    const stmt = db.prepare(INSERT_OTEL_EVENT);

    for (const row of rows) {
      try {
        stmt.run(row);
        accepted++;
      } catch (err) {
        insertDropped++;
        console.error('[/v1/logs] Failed to insert otel_event row:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[/v1/logs] Database unavailable:', err instanceof Error ? err.message : err);
    insertDropped += rows.length - accepted;
  }

  return NextResponse.json({ accepted, dropped: parseDropped + insertDropped });
}

// Explicitly reject non-POST methods with 405 so curl mistakes are obvious
export async function GET(): Promise<NextResponse> {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
