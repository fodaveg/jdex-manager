import type { Plugin } from "obsidian";
import { systemKey, type JdIndex } from "../jd/index";
import { findJdNumbers } from "../jd/reading-links";

/** Ancestors whose text is never touched: real links, code, embeds, math and the properties block. */
const SKIP = "a, code, pre, .internal-embed, .frontmatter, .metadata-container, .math";

function noteName(notePath: string): string {
  const base = notePath.slice(notePath.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * Turns a bare `21.22` in reading view into a link to its JDex note, without touching the file.
 * Reading view only: Live Preview would need a CodeMirror extension and is out of scope.
 * Obsidian handles click and hover through `internal-link` + `data-href`.
 */
export function registerReadingLinks(plugin: Plugin, ctx: { index: () => JdIndex; enabled: () => boolean }): void {
  plugin.registerMarkdownPostProcessor((el) => {
    if (!ctx.enabled()) return;
    const index = ctx.index();
    if (index.ids.length === 0) return;
    const notes = new Map<string, string>();
    for (const entry of index.ids) if (entry.notePath) notes.set(systemKey(entry.id, entry.system), noteName(entry.notePath));
    const exists = (id: string, system?: string): boolean => notes.has(systemKey(id, system));

    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      if (text.parentElement?.closest(SKIP)) continue;
      if (!/\d{2}\.\d{2}/.test(text.data)) continue;
      nodes.push(text);
    }

    for (const text of nodes) {
      const matches = findJdNumbers(text.data, exists);
      if (matches.length === 0) continue;
      const frag = doc.createDocumentFragment();
      let cursor = 0;
      for (const m of matches) {
        if (m.start > cursor) frag.append(text.data.slice(cursor, m.start));
        const name = notes.get(systemKey(m.id, m.system));
        if (name === undefined) continue;
        const a = doc.createElement("a");
        a.className = "internal-link jdex-number-link";
        a.dataset.href = name;
        a.href = name;
        a.textContent = text.data.slice(m.start, m.end);
        frag.append(a);
        cursor = m.end;
      }
      if (cursor < text.data.length) frag.append(text.data.slice(cursor));
      text.replaceWith(frag);
    }
  });
}
