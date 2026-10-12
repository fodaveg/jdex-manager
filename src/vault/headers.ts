import { type App, TFile } from "obsidian";
import { childrenOf, headerEntries, renderChildren, replaceChildrenBlock, wrapFirstLinkList } from "../jd/headers";
import type { JdIndex } from "../jd/index";
import type { Effect } from "../jd/journal";

/**
 * Regenerates the children block of every header note that has markers. Returns how many notes changed.
 * `skip` leaves out notes an undo just restored. `stopped` (plugin unloaded) ends the pass before
 * its next write.
 */
export async function updateHeaders(app: App, index: JdIndex, onlyCategory?: string, effects?: Effect[], skip?: (path: string) => boolean, stopped?: () => boolean): Promise<number> {
  let changed = 0;
  for (const header of headerEntries(index)) {
    if (stopped?.()) break;
    if (onlyCategory && header.category !== onlyCategory) continue;
    if (skip?.(header.notePath!)) continue;
    const file = app.vault.getAbstractFileByPath(header.notePath!);
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.read(file);
    const next = replaceChildrenBlock(content, renderChildren(childrenOf(index, header.id, header.system)));
    if (next === null || next === content) continue;
    if (stopped?.()) break;
    let effect: Effect | null = null;
    await app.vault.process(file, (current) => {
      const updated = replaceChildrenBlock(current, renderChildren(childrenOf(index, header.id, header.system)));
      if (updated === null || updated === current) return current;
      effect = { kind: "note-rewrite", path: file.path, before: current, after: updated };
      return updated;
    });
    if (effect) {
      effects?.push(effect);
      changed += 1;
    }
  }
  return changed;
}

/** Header notes without markers whose first wikilink list can be wrapped, with the body
 *  the preview was computed from (`before`) and the wrapped body (`next`). */
export async function headersToMigrate(app: App, index: JdIndex): Promise<{ file: TFile; before: string; next: string }[]> {
  const out: { file: TFile; before: string; next: string }[] = [];
  for (const header of headerEntries(index)) {
    const file = app.vault.getAbstractFileByPath(header.notePath!);
    if (!(file instanceof TFile)) continue;
    const before = await app.vault.read(file);
    const next = wrapFirstLinkList(before);
    if (next !== null) out.push({ file, before, next });
  }
  return out;
}

/**
 * Wraps the previewed header notes atomically (`vault.process`). A note whose body is no
 * longer the one shown in the preview is left as it is and reported in `skipped`, so an
 * edit made in between is never overwritten. `effects` are the journal entries.
 */
export async function applyHeaderWraps(
  app: App,
  todo: readonly { file: TFile; before: string }[],
): Promise<{ written: string[]; skipped: string[]; effects: Effect[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  const effects: Effect[] = [];
  for (const t of todo) {
    let effect: Effect | null = null;
    await app.vault.process(t.file, (current) => {
      if (current !== t.before) return current;
      const next = wrapFirstLinkList(current);
      if (next === null || next === current) return current;
      effect = { kind: "note-rewrite", path: t.file.path, before: current, after: next };
      return next;
    });
    if (effect) {
      effects.push(effect);
      written.push(t.file.path);
    } else {
      skipped.push(t.file.path);
    }
  }
  return { written, skipped, effects };
}
