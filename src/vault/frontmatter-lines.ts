/**
 * Frontmatter writes that touch only the line(s) of the key, for Obsidian. Obsidian's
 * `processFrontMatter` (1.14.4: parse the block to an object, run the callback,
 * stringify the object, splice it back) drops every comment and rewrites quoting, list
 * style and unquoted numbers (`jd: 21.20` comes back as `jd: 21.2`), so the plugin no
 * longer uses it to write.
 *
 * This is a faithful port of Hebra's `setMarkdownProperty` (`hebra/src/lib/notes/
 * markdown.ts`, with `findFrontmatterAtStart` from `markdown/dialect.ts` and the key
 * rules of `notes/frontmatter-key.ts`), so both hosts patch frontmatter the same way.
 * It refuses (returns `null`) whenever the block is not safe to patch: a repeated key
 * (case-insensitive), a root line it does not recognise, `key:value` without a space, a
 * tab-indented continuation, or an opening `---` without a closing delimiter. A `null`
 * value keeps the key with an empty value. `tests/hebra/host-set-property.test.ts`
 * checks it against outputs measured on the real Hebra host
 * (`tests/hebra/fixtures/host-set-property-cases.json`).
 */
import { parseYaml } from 'obsidian';

const PLAIN_KEY_WORD_SOURCE = '[\\p{L}\\p{N}\\p{M}_-]+';
const PLAIN_KEY_SOURCE = `[\\p{L}_][\\p{L}\\p{N}\\p{M}_-]*(?:[ \\t]+${PLAIN_KEY_WORD_SOURCE})*`;
const QUOTED_KEY_SOURCE = "\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^']|'')*'";
const ROOT_FIELD_TOKEN_SOURCE = `${PLAIN_KEY_SOURCE}|${QUOTED_KEY_SOURCE}`;
const PLAIN_KEY_PATTERN = new RegExp(`^(?:${PLAIN_KEY_SOURCE})$`, 'u');
const ROOT_FIELD_PATTERN = new RegExp(`^(${ROOT_FIELD_TOKEN_SOURCE})([ \\t]*:(?:[ \\t]+|$))(.*)$`, 'u');

interface Field {
  from: number;
  to: number;
  value: string;
  prefix: string;
}

interface Frontmatter {
  contentTo: number;
  fields: Map<string, Field>;
  safeToPatch: boolean;
}

function decodeKeyToken(token: string): string | null {
  if (token.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(token);
      return typeof decoded === 'string' ? decoded : null;
    } catch {
      return null;
    }
  }
  if (token.startsWith("'")) return token.endsWith("'") ? token.slice(1, -1).replace(/''/gu, "'") : null;
  return token;
}

function rootField(line: string): { name: string | null; prefix: string } | null {
  const match = ROOT_FIELD_PATTERN.exec(line);
  if (!match) return null;
  return { name: decodeKeyToken(match[1]), prefix: `${match[1]}${match[2]}` };
}

function isSafeFieldContinuation(line: string): boolean {
  return !line || /^ +(?:[^\t]|$)/.test(line) || /^#/.test(line) || /^-[ \t]/.test(line);
}

function findFrontmatter(source: string): { contentTo: number; bodyFrom: number } | null {
  const firstNewline = source.indexOf('\n');
  const firstTo = firstNewline < 0 ? source.length : firstNewline + 1;
  const firstText = source.slice(0, firstTo).replace(/\r?\n$/, '');
  if (firstText !== '---' && firstText !== '\uFEFF---') return null;
  let cursor = firstTo;
  while (cursor < source.length) {
    const newline = source.indexOf('\n', cursor);
    const to = newline < 0 ? source.length : newline + 1;
    const delimiter = source.slice(cursor, to).replace(/\r?\n$/, '');
    if (delimiter === '---' || delimiter === '...') return { contentTo: cursor, bodyFrom: to };
    cursor = to;
  }
  return null;
}

function frontmatterAtStart(markdown: string): Frontmatter | null {
  const portable = findFrontmatter(markdown);
  if (!portable) return null;
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let cursor = 0;
  while (cursor < portable.bodyFrom) {
    const newline = markdown.indexOf('\n', cursor);
    const to = newline < 0 ? markdown.length : newline + 1;
    lines.push({ from: cursor, to, text: markdown.slice(cursor, to).replace(/\r?\n$/, '') });
    cursor = to;
  }
  const closing = lines.findIndex((line) => line.from === portable.contentTo);
  if (closing < 0) return null;
  const fields = new Map<string, Field>();
  let safeToPatch = true;
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    const field = rootField(line.text);
    if (!field) {
      if (!/^[ \t]*$/.test(line.text) && !/^[ \t]*#/.test(line.text)) safeToPatch = false;
      continue;
    }
    if (!field.name) {
      safeToPatch = false;
      continue;
    }
    const name = field.name.toLowerCase();
    if (fields.has(name)) safeToPatch = false;
    let end = index + 1;
    while (end < closing && rootField(lines[end].text) === null) {
      if (!isSafeFieldContinuation(lines[end].text)) {
        safeToPatch = false;
        break;
      }
      end += 1;
    }
    fields.set(name, { from: line.from, to: lines[end - 1].to, value: markdown.slice(line.from, lines[end - 1].to), prefix: field.prefix });
    index = end - 1;
  }
  return { contentTo: portable.contentTo, fields, safeToPatch };
}

function yamlInlineComment(line: string): string {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && !single && line[index - 1] !== '\\') double = !double;
    else if (character === "'" && !double) {
      if (single && line[index + 1] === "'") index += 1;
      else single = !single;
    } else if (character === '#' && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      return index === 0 ? line : line.slice(index - 1);
    }
  }
  return '';
}

function preservedFieldComments(value: string): string {
  const newline = value.includes('\r\n') ? '\r\n' : '\n';
  const lines = value.replace(/\r?\n$/, '').split(/\r?\n/);
  const inline = yamlInlineComment(lines[0]);
  const trivia = lines.slice(1).filter((line) => /^\s*(?:#.*)?$/.test(line));
  return `${inline}${newline}${trivia.length ? `${trivia.join(newline)}${newline}` : ''}`;
}

function splice(source: string, from: number, to: number, insert: string): string {
  return source.slice(0, from) + insert + source.slice(to);
}

function replaceField(markdown: string, name: string, serializedValue: string): string | null {
  const frontmatter = frontmatterAtStart(markdown);
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const separator = serializedValue === '' ? '' : ' ';
  const token = PLAIN_KEY_PATTERN.test(name) ? name : JSON.stringify(name);
  const defaultLine = `${token}:${separator}${serializedValue}${newline}`;
  if (!frontmatter) {
    if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(markdown)) return null;
    const bodyFrom = markdown.startsWith('\uFEFF') ? 1 : 0;
    const body = markdown.slice(bodyFrom);
    const trimmed = body.replace(/^\s+/, '');
    return splice(markdown, bodyFrom, bodyFrom + body.length - trimmed.length, `---${newline}${defaultLine}---${newline}${newline}`);
  }
  if (!frontmatter.safeToPatch) return null;
  const existing = frontmatter.fields.get(name.toLowerCase());
  if (existing) {
    const preserved = preservedFieldComments(existing.value);
    const gap = existing.prefix.endsWith(':') ? ' ' : '';
    const line = `${existing.prefix}${gap}${serializedValue}\n`;
    return splice(markdown, existing.from, existing.to, line.replace(/\n$/, preserved));
  }
  return splice(markdown, frontmatter.contentTo, frontmatter.contentTo, defaultLine);
}

export type FrontmatterLineValue = string | readonly string[] | null;

/** The YAML text between the delimiters of the frontmatter at the start, or `null`. */
export function frontmatterSource(markdown: string): string | null {
  const span = findFrontmatter(markdown);
  if (!span) return null;
  const firstNewline = markdown.indexOf('\n');
  return markdown.slice(firstNewline + 1, span.contentTo);
}

/** The frontmatter as Obsidian reads it (`parseYaml`), or `null` without one or when unreadable. */
export function readFrontmatter(markdown: string): Record<string, unknown> | null {
  const source = frontmatterSource(markdown);
  if (source === null) return null;
  try {
    const value: unknown = parseYaml(source);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Writes one root key, touching only its line(s). `null` when it cannot be done
 * safely (the cases above, or an empty key): the caller must not fall back to
 * reserialising the whole block.
 */
export function setFrontmatterProperty(markdown: string, name: string, value: FrontmatterLineValue): string | null {
  const normalizedName = name.trim();
  if (!normalizedName || /[\r\n]/u.test(normalizedName)) return null;
  return replaceField(markdown, normalizedName, value === null ? '' : JSON.stringify(value));
}

/** Writes every key of `set`, or none: `refused` lists the keys that could not be written safely. */
export function patchFrontmatter(markdown: string, set: Readonly<Record<string, FrontmatterLineValue>>): { body: string; refused: string[] } {
  let body = markdown;
  const refused: string[] = [];
  for (const [key, value] of Object.entries(set)) {
    const next = setFrontmatterProperty(body, key, value);
    if (next === null) refused.push(key);
    else body = next;
  }
  return refused.length > 0 ? { body: markdown, refused } : { body, refused };
}
