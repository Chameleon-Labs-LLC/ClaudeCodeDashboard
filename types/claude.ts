/** Represents a Claude Code session (conversation) */
export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  summary?: string;
}

/** A single message within a session */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  toolUse?: ToolUseEntry[];
}

/** Tool use within a message */
export interface ToolUseEntry {
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
}

/** Session detail including messages */
export interface SessionDetail extends Session {
  messages: SessionMessage[];
}

/** A memory file with frontmatter */
export interface MemoryEntry {
  fileName: string;
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
  filePath: string;
}

/** Memory index from MEMORY.md */
export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  raw: string;
}

export interface MemoryIndexEntry {
  title: string;
  file: string;
  description: string;
}

/** A registered project in Claude Code */
export interface Project {
  path: string;
  name: string;
  hasClaudeMd: boolean;
  hasMemory: boolean;
  sessionCount: number;
  lastActive?: string;
}

/** Search result across sessions and memory */
export interface SearchResult {
  type: 'session' | 'memory' | 'project';
  title: string;
  snippet: string;
  path: string;
  score: number;
  timestamp?: string;
}

/** Dashboard stats overview */
export interface DashboardStats {
  totalSessions: number;
  totalProjects: number;
  totalMemories: number;
  recentSessions: Session[];
  recentProjects: Project[];
}
