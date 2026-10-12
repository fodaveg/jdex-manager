import { Notice, TFile, type Plugin } from "obsidian";
import { systemKey, type IdEntry, type JdIndex } from "../jd/index";
import { entriesByNumber, findJdNumbers } from "../jd/reading-links";
import { t } from "../ui/i18n";

/** Ancestors whose text is never touched: real links, code, embeds, math and the properties block. */
const SKIP = "a, code, pre, .internal-embed, .frontmatter, .metadata-container, .math";

/** Characters a link path cannot carry in Obsidian: it reads them as heading, block, alias or nesting. */
const UNSAFE_IN_LINK = /[#^|[\]]/;

function noteName(notePath: string): string {
  const base = notePath.slice(notePath.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export interface ReadingLinksContext {
  index: () => JdIndex;
  enabled: () => boolean;
  /** Asks which of several entries sharing one number (`21.22+` children) to open; `null` = cancelled. */
  choose?: (entries: IdEntry[]) => Promise<IdEntry | null>;
}

/**
 * Turns a bare `21.22` in reading view into a link to its JDex note, without touching the file.
 * Reading view only: Live Preview would need a CodeMirror extension and is out of scope.
 *
 * The link carries the NUMBER in `data-jd`, not its destination: the destination is looked up in
 * the current index when the link is pressed, so a rename after rendering still lands on the note
 * (and never on a stale name that Obsidian would offer to create). `data-href` stays only for the
 * hover preview. Several `AC.ID+` children share one number: pressing it asks which one.
 */
export function registerReadingLinks(plugin: Plugin, ctx: ReadingLinksContext): void {
  plugin.registerMarkdownPostProcessor((el) => {
    if (!ctx.enabled()) return;
    const index = ctx.index();
    if (index.ids.length === 0) return;
    const groups = entriesByNumber(index.ids.filter((entry) => entry.notePath));
    const exists = (id: string, system?: string): boolean => groups.has(systemKey(id, system));

    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      if (text.parentElement?.closest(SKIP)) continue;
      if (!/\d{2}\.\d{2}/.test(text.data)) continue;
      nodes.push(text);
    }

    let made = 0;
    for (const text of nodes) {
      const matches = findJdNumbers(text.data, exists);
      if (matches.length === 0) continue;
      const frag = doc.createDocumentFragment();
      let cursor = 0;
      for (const m of matches) {
        const group = groups.get(systemKey(m.id, m.system));
        if (group === undefined || group.length === 0) continue;
        if (m.start > cursor) frag.append(text.data.slice(cursor, m.start));
        const a = doc.createElement("a");
        a.dataset.jd = systemKey(m.id, m.system);
        a.textContent = text.data.slice(m.start, m.end);
        const hover = group.length === 1 && group[0].notePath ? noteName(group[0].notePath) : undefined;
        if (hover !== undefined && !UNSAFE_IN_LINK.test(hover)) {
          // Hover preview only; the click never trusts this value (see the listener below).
          a.className = "internal-link jdex-number-link";
          a.dataset.href = hover;
          a.href = hover;
        } else {
          a.className = "jdex-number-link";
          a.tabIndex = 0;
        }
        frag.append(a);
        cursor = m.end;
        made += 1;
      }
      if (cursor < text.data.length) frag.append(text.data.slice(cursor));
      text.replaceWith(frag);
    }
    if (made === 0) return;

    // Capture phase on the rendered block: it runs before any handler Obsidian attaches higher up,
    // so a number is never opened through the destination fixed at render time.
    const linkOf = (event: Event): { target: HTMLElement; key: string } | null => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("a.jdex-number-link") : null;
      const key = target?.dataset.jd;
      return target && key !== undefined ? { target, key } : null;
    };
    el.addEventListener(
      "click",
      (event: MouseEvent) => {
        const link = linkOf(event);
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        void openNumber(plugin, ctx, link.key, event.ctrlKey || event.metaKey);
      },
      true,
    );
    // The middle button opens a new tab, resolved the same way; the right button is left alone.
    el.addEventListener(
      "auxclick",
      (event: MouseEvent) => {
        const link = event.button === 1 ? linkOf(event) : null;
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        void openNumber(plugin, ctx, link.key, true);
      },
      true,
    );
    // Enter on the focusable variant without href (with href, the browser turns Enter into a click).
    el.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== "Enter") return;
        const link = linkOf(event);
        if (!link || link.target.hasAttribute("href")) return;
        event.preventDefault();
        event.stopPropagation();
        void openNumber(plugin, ctx, link.key, event.ctrlKey || event.metaKey);
      },
      true,
    );
  });
}

async function openNumber(plugin: Plugin, ctx: ReadingLinksContext, key: string, newTab: boolean): Promise<void> {
  const entries = entriesByNumber(ctx.index().ids.filter((entry) => entry.notePath)).get(key) ?? [];
  if (entries.length === 0) {
    new Notice(t().readingLinkGone(key));
    return;
  }
  let entry: IdEntry | null = entries[0];
  if (entries.length > 1) entry = ctx.choose ? await ctx.choose(entries) : null;
  if (!entry?.notePath) return;
  const file = plugin.app.vault.getAbstractFileByPath(entry.notePath);
  if (!(file instanceof TFile)) {
    new Notice(t().readingLinkNoteGone(entry.label));
    return;
  }
  await plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
}
