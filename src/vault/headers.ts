import { type App, TFile } from "obsidian";
import { childrenOf, headerEntries, renderChildren, replaceChildrenBlock, wrapFirstLinkList } from "../jd/headers";
import type { JdIndex } from "../jd/index";

/** Regenerates the children block of every header note that has markers. Returns how many notes changed. */
export async function updateHeaders(app: App, index: JdIndex, onlyCategory?: string): Promise<number> {
  let changed = 0;
  for (const header of headerEntries(index)) {
    if (onlyCategory && header.category !== onlyCategory) continue;
    const file = app.vault.getAbstractFileByPath(header.notePath!);
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.read(file);
    const next = replaceChildrenBlock(content, renderChildren(childrenOf(index, header.id)));
    if (next === null || next === content) continue;
    await app.vault.modify(file, next);
    changed += 1;
  }
  return changed;
}

/** Header notes without markers whose first wikilink list can be wrapped. */
export async function headersToMigrate(app: App, index: JdIndex): Promise<{ file: TFile; next: string }[]> {
  const out: { file: TFile; next: string }[] = [];
  for (const header of headerEntries(index)) {
    const file = app.vault.getAbstractFileByPath(header.notePath!);
    if (!(file instanceof TFile)) continue;
    const next = wrapFirstLinkList(await app.vault.read(file));
    if (next !== null) out.push({ file, next });
  }
  return out;
}
