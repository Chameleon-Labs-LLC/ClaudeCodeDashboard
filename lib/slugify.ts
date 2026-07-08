/** GitHub-style heading anchor: lowercase, strip punctuation, spaces→hyphens.
 *  Kept dependency-free and fs-free so client components can import it. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}
