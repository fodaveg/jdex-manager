/**
 * Frontmatter writes that check their own result. Hebra's `api.markdown.setProperty`
 * returns the body UNCHANGED when the frontmatter is not safe to patch (a repeated key,
 * a root line it does not recognise, `key:value` without a space, a tab continuation,
 * an opening `---` without a closing one). An unchanged body is therefore not proof
 * that there was nothing to do: after each key, the written frontmatter is read back
 * and compared with the value that was asked for.
 */
import type { PluginMarkdown } from 'hebra-plugin-api';

export type JdexPropertyValue = string | readonly string[] | null;

/** Reads the frontmatter of a body as an object (`null` without one or when unreadable). */
export type JdexFrontmatterReader = (body: string) => Record<string, unknown> | null;

/** Whether a frontmatter value read back equals the value that was written. */
export function jdexPropertyMatches(actual: unknown, expected: JdexPropertyValue): boolean {
  if (expected === null) return actual === null || actual === undefined || actual === '';
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && actual.every((item, i) => String(item) === expected[i]);
  }
  if (typeof actual === 'string') return actual.trim() === (expected as string).trim();
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected;
  return false;
}

/**
 * Applies `set` to `body` key by key and reports the keys that did NOT end up with
 * their value. Callers must not write a body with `unwritten` keys as if it were done.
 */
export function setJdexProperties(
  markdown: Pick<PluginMarkdown, 'setProperty'>,
  read: JdexFrontmatterReader,
  body: string,
  set: Readonly<Record<string, JdexPropertyValue>>
): { body: string; unwritten: string[] } {
  let next = body;
  const unwritten: string[] = [];
  for (const [key, value] of Object.entries(set)) {
    next = markdown.setProperty(next, key, value);
    if (!jdexPropertyMatches(read(next)?.[key], value)) unwritten.push(key);
  }
  return { body: next, unwritten };
}
