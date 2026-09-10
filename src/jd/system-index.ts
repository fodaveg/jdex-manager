/**
 * The whole system as one nested list, kept between markers in a note (johnnydecimal.com,
 * "JDex: two other methods"). Pure.
 */

import { headerRange } from "./headers";
import type { IdEntry, JdIndex } from "./index";

export const INDEX_START = "<!-- jdex:indice -->";
export const INDEX_END = "<!-- /jdex:indice -->";

function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -3);
}

function item(label: string, notePath: string | undefined, description?: string): string {
  const text = notePath ? `[[${noteName(notePath)}]]` : label;
  return description ? `${text} · ${description}` : text;
}

/** `descriptions`: frontmatter `descripcion` by note path. */
export function renderSystemIndex(index: JdIndex, descriptions: Map<string, string> = new Map()): string {
  const lines: string[] = [];
  const desc = (p?: string): string | undefined => (p ? descriptions.get(p) : undefined);
  for (const area of index.areas) {
    lines.push(`- ${item(area.label, area.notePath, desc(area.notePath))}`);
    for (const category of index.categories.filter((c) => c.areaNumber === area.number)) {
      lines.push(`  - ${item(category.label, category.notePath, desc(category.notePath))}`);
      const ids = index.ids.filter((e) => e.category === category.number && !e.id.endsWith("+"));
      const headers = ids.filter((e) => headerRange(e.id) !== null);
      const placed = new Set<string>();
      const idLine = (e: IdEntry, indent: string): string => {
        placed.add(e.id);
        const children = index.ids.filter((c) => c.id === `${e.id}+`);
        const out = [`${indent}- ${item(e.label, e.notePath, desc(e.notePath))}`];
        for (const c of children) out.push(`${indent}  - ${item(c.label, c.notePath, desc(c.notePath))}`);
        return out.join("\n");
      };
      // Zeros and ids before the first header stay at category level, in order.
      for (const e of ids) {
        if (placed.has(e.id)) continue;
        const range = headerRange(e.id);
        if (range) {
          lines.push(idLine(e, "    "));
          for (const child of ids) {
            const last = Number(child.id.split(".")[1]);
            if (!placed.has(child.id) && last >= range.from && last <= range.to) lines.push(idLine(child, "      "));
          }
          continue;
        }
        const last = Number(e.id.split(".")[1]);
        const owner = headers.find((h) => {
          const r = headerRange(h.id)!;
          return last >= r.from && last <= r.to;
        });
        if (owner && !placed.has(owner.id)) continue; // will be placed under its header when the header comes
        lines.push(idLine(e, "    "));
      }
    }
  }
  return lines.join("\n");
}

/** Replaces what sits between the index markers. Null when the note has no markers. */
export function replaceSystemIndex(content: string, body: string): string | null {
  const start = content.indexOf(INDEX_START);
  const end = content.indexOf(INDEX_END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${content.slice(0, start + INDEX_START.length)}\n${body}\n${content.slice(end)}`;
}

/** Appends an empty marker block at the end of a note that has none. */
export function appendIndexMarkers(content: string): string {
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}\n## Índice del sistema\n\n${INDEX_START}\n${INDEX_END}\n`;
}
