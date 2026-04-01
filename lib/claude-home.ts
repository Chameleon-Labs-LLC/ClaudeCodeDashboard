import path from 'path';
import os from 'os';

/** Resolve the Claude Code home directory */
export function getClaudeHome(): string {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
}

/** Resolve the projects directory */
export function getProjectsDir(): string {
  return path.join(getClaudeHome(), 'projects');
}
