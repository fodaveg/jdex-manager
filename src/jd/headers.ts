/**
 * Live headers: the list of children of an `AC.X0 ■` note, kept between two markers.
 * Pure. Outside the markers nothing is ever touched.
 */

import type { IdEntry, JdIndex } from "./index";
import { parseJdNumber } from "./parse";

export const CHILDREN_START = "<!-- jdex:hijos -->";
export const CHILDREN_END = "<!-- /jdex:hijos -->";

/** `11.10` → IDs 11.11 to 11.19 (11.20 → 11.21 to 11.29). Null when not a header number. */
export function headerRange(headerId: string): { category: string; from: number; to: number } | null {
  const n = parseJdNumber(headerId);
  if (!n || n.kind !== "id" || n.extension) return null;
  const last = Number(n.id.split(".")[1]);
  if (last === 0 || last % 10 !== 0) return null;
  return { category: n.category, from: last + 1, to: last + 9 };
}

/** The IDs of the index that fall under a header, ordered by number. Extensions (`+`) are skipped. */
export function childrenOf(index: JdIndex, headerId: string): IdEntry[] {
  const range = headerRange(headerId);
  if (!range) return [];
  return index.ids
    .filter((e) => {
      if (e.id.endsWith("+") || e.category !== range.category) return false;
      const last = Number(e.id.split(".")[1]);
      return last >= range.from && last <= range.to;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** One `- [[note]]` line per child; children without a note are listed as plain text. */
export function renderChildren(children: IdEntry[]): string {
  return children
    .map((c) => {
      if (!c.notePath) return `- ${c.label}`;
      const name = c.notePath.slice(c.notePath.lastIndexOf("/") + 1, -3);
      return `- [[${name}]]`;
    })
    .join("\n");
}

/** Replaces what sits between the markers. Null when the note has no markers. */
export function replaceChildrenBlock(content: string, body: string): string | null {
  const start = content.indexOf(CHILDREN_START);
  const end = content.indexOf(CHILDREN_END);
  if (start === -1 || end === -1 || end < start) return null;
  const before = content.slice(0, start + CHILDREN_START.length);
  const after = content.slice(end);
  return `${before}\n${body}\n${after}`;
}

/** Wraps the first contiguous list of `- [[...]]` lines in markers. Null when there is none or markers exist. */
export function wrapFirstLinkList(content: string): string | null {
  if (content.includes(CHILDREN_START)) return null;
  const lines = content.split("\n");
  const isLink = (l: string): boolean => /^\s*[-*]\s+\[\[.+\]\]\s*$/.test(l);
  const first = lines.findIndex(isLink);
  if (first === -1) return null;
  let last = first;
  while (last + 1 < lines.length && isLink(lines[last + 1])) last += 1;
  const out = [...lines.slice(0, first), CHILDREN_START, ...lines.slice(first, last + 1), CHILDREN_END, ...lines.slice(last + 1)];
  return out.join("\n");
}

/** Header notes of the index: IDs ending in X0 (X ≥ 1) that have a note. */
export function headerEntries(index: JdIndex): IdEntry[] {
  return index.ids.filter((e) => e.notePath && headerRange(e.id) !== null);
}
