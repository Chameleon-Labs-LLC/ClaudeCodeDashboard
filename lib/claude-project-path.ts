import path from 'path';

/**
 * Decode a Claude Code project directory name back to a filesystem path.
 *
 * Claude stores project session folders under ~/.claude/projects using a path-like
 * encoding. We keep the decoding logic in one place so API routes and UI labels stay
 * consistent.
 */
export function decodeClaudeProjectPath(encoded: string): string {
  if (!encoded) {
    throw new Error('Invalid empty project path');
  }

  let decoded: string;
  if (/^[A-Za-z]--/.test(encoded)) {
    decoded = encoded.replace(/^([A-Za-z])--/, '$1:/').replace(/-/g, '/');
  } else if (encoded.startsWith('-')) {
    decoded = encoded.replace(/-/g, '/');
  } else {
    throw new Error(`Invalid Claude project encoding: ${encoded}`);
  }

  if (!path.isAbsolute(decoded)) {
    throw new Error(`Decoded Claude project path is not absolute: ${decoded}`);
  }

  return path.normalize(decoded);
}

/**
 * Human-readable label for an encoded Claude project directory.
 */
export function formatClaudeProjectName(encoded: string): string {
  try {
    return decodeClaudeProjectPath(encoded);
  } catch {
    return encoded;
  }
}
