import fs from 'fs/promises';
import path from 'path';
import { getProjectsDir } from './claude-home';

export interface SessionUsage {
  sessionId: string;
  projectName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
  messageCount: number;
  startedAt: string;
}

export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCost: number;
  sessionUsages: SessionUsage[];
  byModel: Record<string, { input: number; output: number; cost: number }>;
  byDay: Array<{ date: string; tokens: number; cost: number }>;
}

// Cost rates per million tokens
const COST_RATES: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
};

function getModelRates(model: string): { input: number; output: number } {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return COST_RATES.opus;
  if (lower.includes('haiku')) return COST_RATES.haiku;
  // Default to sonnet rates
  return COST_RATES.sonnet;
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const rates = getModelRates(model);
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

function getModelFamily(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/**
 * Scan all project dirs for all .jsonl session files and aggregate token usage.
 */
export async function getUsageStats(): Promise<UsageStats> {
  const stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheTokens: 0,
    totalCost: 0,
    sessionUsages: [],
    byModel: {},
    byDay: [],
  };

  try {
    const projectsDir = getProjectsDir();
    const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });

    const dayMap = new Map<string, { tokens: number; cost: number }>();

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectPath = path.join(projectsDir, projectDir.name);
      let entries: string[];

      try {
        entries = await fs.readdir(projectPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(projectPath, entry);

        let entryStat;
        try {
          entryStat = await fs.stat(entryPath);
        } catch {
          continue;
        }

        if (entryStat.isFile() && entry.endsWith('.jsonl')) {
          // Session .jsonl files at the project level
          const sessionId = entry.replace('.jsonl', '');
          await processSessionFile(entryPath, sessionId, projectDir.name, stats, dayMap);
        } else if (entryStat.isDirectory()) {
          // Also check for .jsonl files inside subdirectories (e.g. subagents)
          let files: string[];
          try {
            files = await fs.readdir(entryPath);
          } catch {
            continue;
          }

          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            const filePath = path.join(entryPath, file);
            await processSessionFile(filePath, entry, projectDir.name, stats, dayMap);
          }
        }
      }
    }

    // Convert dayMap to sorted byDay array
    stats.byDay = Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, tokens: data.tokens, cost: data.cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return stats;
  } catch {
    return stats;
  }
}

async function processSessionFile(
  filePath: string,
  sessionId: string,
  projectName: string,
  stats: UsageStats,
  dayMap: Map<string, { tokens: number; cost: number }>
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let model = '';
    let messageCount = 0;
    let startedAt = '';

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);

        // Extract timestamp for start time
        if (!startedAt && obj.timestamp) {
          startedAt = new Date(
            typeof obj.timestamp === 'number' ? obj.timestamp : obj.timestamp
          ).toISOString();
        }

        // Only process assistant messages with usage data
        if (obj.message?.role !== 'assistant') continue;
        if (!obj.message?.usage) continue;

        messageCount++;

        const usage = obj.message.usage;
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        cacheReadTokens += usage.cache_read_input_tokens || 0;

        if (obj.message.model && !model) {
          model = obj.message.model;
        }
      } catch {
        // Skip unparseable lines (some can be very large)
      }
    }

    if (messageCount === 0) return;

    const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    const cost = estimateCost(inputTokens + cacheCreationTokens, outputTokens, model);

    const sessionUsage: SessionUsage = {
      sessionId,
      projectName,
      model: model || 'unknown',
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens,
      estimatedCost: cost,
      messageCount,
      startedAt,
    };

    stats.sessionUsages.push(sessionUsage);
    stats.totalInputTokens += inputTokens;
    stats.totalOutputTokens += outputTokens;
    stats.totalCacheTokens += cacheCreationTokens + cacheReadTokens;
    stats.totalCost += cost;

    // Aggregate by model
    const family = getModelFamily(model);
    if (!stats.byModel[family]) {
      stats.byModel[family] = { input: 0, output: 0, cost: 0 };
    }
    stats.byModel[family].input += inputTokens + cacheCreationTokens;
    stats.byModel[family].output += outputTokens;
    stats.byModel[family].cost += cost;

    // Aggregate by day
    if (startedAt) {
      const day = startedAt.slice(0, 10); // YYYY-MM-DD
      const existing = dayMap.get(day) || { tokens: 0, cost: 0 };
      existing.tokens += totalTokens;
      existing.cost += cost;
      dayMap.set(day, existing);
    }
  } catch {
    // Skip files that can't be read
  }
}
