/**
 * Which parts of a Markdown note are NOT prose, so a bare JD number there is left alone
 * (audit 12 oct 2026: «no decorar código, wikilinks ni propiedades»): the properties block at
 * the top, fenced code, inline code, wikilinks and embeds, the target of a Markdown link and
 * bare URLs. A line scanner, not a parser: Hebra's extension runs without the Markdown syntax
 * tree, and the cases that matter are all line-shaped.
 *
 * `maskNonProse` returns a string of the SAME length with those spans replaced by NUL, so every
 * offset found in it is a valid offset of the original text.
 */

const MASK = '\u0000';

/** Masks `[from, to)` of one line, in place, on an array of chars. */
function maskRange(chars: string[], from: number, to: number): void {
  for (let i = from; i < to; i += 1) if (chars[i] !== '\n') chars[i] = MASK;
}

/** Spans inside one line (`line` starts at `base` in the document). */
function maskInline(chars: string[], line: string, base: number): void {
  // Inline code: a run of N backticks closes at the next run of exactly N, on the same line.
  const code = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  for (let m = code.exec(line); m; m = code.exec(line)) maskRange(chars, base + m.index, base + m.index + m[0].length);
  // Wikilinks and embeds.
  const wiki = /!?\[\[[^\]\n]*\]\]/g;
  for (let m = wiki.exec(line); m; m = wiki.exec(line)) maskRange(chars, base + m.index, base + m.index + m[0].length);
  // The destination of a Markdown link or image: `](…)`.
  const dest = /\]\([^)\n]*\)/g;
  for (let m = dest.exec(line); m; m = dest.exec(line)) maskRange(chars, base + m.index, base + m.index + m[0].length);
  // Bare URLs.
  const url = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
  for (let m = url.exec(line); m; m = url.exec(line)) maskRange(chars, base + m.index, base + m.index + m[0].length);
}

export function maskNonProse(text: string): string {
  if (text === '') return text;
  const chars = text.split('');
  const lines = text.split('\n');
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let inProperties = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const base = offset;
    offset += line.length + 1;

    if (i === 0 && /^---\s*$/.test(line)) {
      inProperties = true;
      maskRange(chars, base, base + line.length);
      continue;
    }
    if (inProperties) {
      maskRange(chars, base, base + line.length);
      if (/^(---|\.\.\.)\s*$/.test(line)) inProperties = false;
      continue;
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      maskRange(chars, base, base + line.length);
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      maskRange(chars, base, base + line.length);
      continue;
    }
    maskInline(chars, line, base);
  }
  return chars.join('');
}
