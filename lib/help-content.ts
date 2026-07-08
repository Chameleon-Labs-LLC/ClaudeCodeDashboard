import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { slugify } from './slugify';

export interface HelpSection {
  id: string;
  text: string;
}

export interface HelpTopic {
  slug: string;
  title: string;
  body: string;
  sections: HelpSection[];
}

const DEFAULT_DIR = path.join(process.cwd(), 'content', 'help');

/** Load one help topic from content/help/<slug>.md. Returns null when the
 *  slug is malformed or the file is missing — callers render a fallback. */
export function getHelpTopic(slug: string, dir: string = DEFAULT_DIR): HelpTopic | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf-8');
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const title = typeof data.title === 'string' && data.title.length > 0 ? data.title : slug;
  const sections: HelpSection[] = [];
  for (const line of content.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) sections.push({ id: slugify(m[1]), text: m[1] });
  }
  return { slug, title, body: content, sections };
}
