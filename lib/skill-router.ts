/**
 * Skill router — selects the best matching skill for a task.
 *
 * STUB: always returns null. Haiku integration is a follow-up task.
 *
 * To implement:
 *   1. Add @anthropic-ai/sdk to dependencies.
 *   2. Set ANTHROPIC_API_KEY in .env.
 *   3. Call claude-3-haiku-20240307 with:
 *      "Given task title '<title>' and description '<desc>', which skill
 *       from this list best matches? Reply with exactly the skill name
 *       or 'none': <skills.join(', ')>"
 *   Estimated cost: ~$0.0001 per pick.
 */
export async function pickSkill(
  _title: string,
  _description: string,
  _skills: string[],
): Promise<string | null> {
  return null;
}
