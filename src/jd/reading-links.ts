/**
 * Pure part of "clickable numbers in reading view": finds bare Johnny.Decimal numbers in a text.
 * No Obsidian imports; the vault layer walks the rendered DOM and calls this on each text node.
 *
 * A match is `21.22` or `21.22+`, optionally with a system prefix (`D01.21.22`), that stands on
 * its own: no digit or letter glued to it, directly or through a dot, so `2026.09.16`, `v1.21.22`,
 * `21.22.1` and `21.223` are left alone while `… 21.22.` at the end of a sentence still matches. Only the numbers `exists` accepts are returned.
 */

export interface NumberMatch {
  /** Offset of the first character of the match in `text`. */
  start: number;
  /** Offset just past the last character. */
  end: number;
  /** `21.22` or `21.22+`, without the system prefix. */
  id: string;
  /** `D01` when the text carried one. */
  system?: string;
}

const NUMBER = /(?:([A-Z]\d{2})\.)?(\d{2}\.\d{2}\+?)/g;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** A dot glues the number to a neighbour only when there is a word character on its other side (`v1.21.22`, `21.22.1`); a full stop after it does not (`… 21.22.`). */
function glued(text: string, at: number, dir: -1 | 1): boolean {
  const ch = text[at];
  if (isWordChar(ch)) return true;
  return ch === "." && isWordChar(text[at + dir]);
}

export function findJdNumbers(text: string, exists: (id: string) => boolean): NumberMatch[] {
  const out: NumberMatch[] = [];
  NUMBER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const id = m[2];
    if (glued(text, start - 1, -1) || glued(text, end, 1)) continue;
    if (!exists(id)) continue;
    out.push(m[1] ? { start, end, id, system: m[1] } : { start, end, id });
  }
  return out;
}
