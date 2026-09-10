/**
 * Proposes a `descripcion` for a JDex note from its body: the first plain sentence after the H1.
 * Pure.
 */

const MAX = 200;

/** The body without frontmatter. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\r?\n/, "");
}

/** First paragraph that is prose: no headings, lists, code fences, dataview, html comments, tables or callouts. */
export function firstSentence(content: string): string | null {
  const lines = stripFrontmatter(content).split("\n");
  let inFence = false;
  let paragraph: string[] = [];
  const flush = (): string | null => {
    if (paragraph.length === 0) return null;
    const text = clean(paragraph.join(" "));
    paragraph = [];
    return text === "" ? null : text;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      const done = flush();
      if (done) return cut(done);
      continue;
    }
    if (inFence) continue;
    if (line === "") {
      const done = flush();
      if (done) return cut(done);
      continue;
    }
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|\||<!--|!\[\[)/.test(line)) {
      const done = flush();
      if (done) return cut(done);
      continue;
    }
    paragraph.push(line);
  }
  const last = flush();
  return last ? cut(last) : null;
}

function clean(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  let out = m ? m[1] : text;
  if (out.length > MAX) out = out.slice(0, MAX - 1).trimEnd() + "…";
  return out;
}
