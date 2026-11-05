import matter from 'gray-matter';

/**
 * Parse Markdown front matter without gray-matter's JavaScript engine.
 *
 * gray-matter 4.0.3 (the latest release) runs `eval` on front matter whose
 * opening fence names a JavaScript language (`---js`, `---javascript`), so
 * any Markdown file the dashboard reads could run code in the server process
 * (SNYK-JS-GRAYMATTER-20532010, no fixed version). The dashboard reads files
 * from the user's ~/.claude tree, which includes third-party plugin content.
 *
 * gray-matter resolves every JavaScript alias to the `javascript` engine key,
 * so replacing that one key closes the path. YAML (the default) and JSON keep
 * working. A JavaScript fence now throws instead of executing.
 */
const refuseJavaScript = (): never => {
  throw new Error('JavaScript front matter is not supported');
};

export function parseFrontMatter(raw: string) {
  return matter(raw, { engines: { javascript: refuseJavaScript } });
}
