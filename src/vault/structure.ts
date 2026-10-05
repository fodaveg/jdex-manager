import { type App, Notice, TFile } from "obsidian";
import { areaCode, sameSystem, findId, type JdIndex } from "../jd/index";
import { jdexNoteName } from "../jd/parse";
import { appendIndexMarkers, renderSystemIndex, replaceSystemIndex } from "../jd/system-index";
import type { JdexManagerSettings } from "../settings";
import { createJdexNote } from "./create";
import type { Effect } from "../jd/journal";

export interface MissingStructure {
  areas: { system?: string; number: number; label: string; title: string }[];
  categories: { system?: string; number: string; areaNumber: number; label: string; title: string }[];
}

export function missingStructureNotes(index: JdIndex): MissingStructure {
  return {
    areas: index.areas.filter((a) => a.path && !a.notePath).map((a) => ({ ...a })),
    categories: index.categories
      .filter((c) => c.path && !c.notePath)
      .map((c) => ({ ...c })),
  };
}

/** Creates the JDex notes of every area and category folder that lacks one. Returns how many were created. */
export async function createMissingStructureNotes(app: App, settings: JdexManagerSettings, index: JdIndex): Promise<number> {
  const missing = missingStructureNotes(index);
  let created = 0;
  for (const a of missing.areas) {
    const code = areaCode(a.number);
    await createJdexNote(app, settings, "area", jdexNoteName(code, a.title, a.system), { id: code, title: a.title, area: code, areaTitle: a.label, category: "", categoryTitle: "" });
    created += 1;
  }
  for (const c of missing.categories) {
    const area = index.areas.find((a) => a.number === c.areaNumber && sameSystem(a, c));
    await createJdexNote(app, settings, "categoria", jdexNoteName(c.number, c.title, c.system), {
      id: c.number,
      title: c.title,
      area: areaCode(c.areaNumber),
      areaTitle: area?.label ?? areaCode(c.areaNumber),
      category: c.number,
      categoryTitle: c.label,
    });
    created += 1;
  }
  return created;
}

/** The note that holds the system index: the setting, or the note of 00.00. */
export function systemIndexFile(app: App, settings: JdexManagerSettings, index: JdIndex): TFile | null {
  const path = settings.systemIndexNote !== "" ? settings.systemIndexNote : findId(index, "00.00")?.notePath;
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

/** Regenerates the block between the index markers; adds the markers at the end when missing. */
export async function updateSystemIndex(app: App, settings: JdexManagerSettings, index: JdIndex, addMarkers: boolean, effects?: Effect[]): Promise<boolean> {
  const file = systemIndexFile(app, settings, index);
  if (!file) {
    new Notice("No note for the system index: set one in the settings or create the 00.00 note.");
    return false;
  }
  const descriptions = new Map<string, string>();
  for (const f of app.vault.getMarkdownFiles()) {
    const d: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.descripcion;
    if (typeof d === "string" && d.trim() !== "") descriptions.set(f.path, d.trim());
  }
  const body = renderSystemIndex(index, descriptions);
  const transform = (content: string): string | null => {
    const next = replaceSystemIndex(content, body);
    return next === null && addMarkers ? replaceSystemIndex(appendIndexMarkers(content), body) : next;
  };
  const content = await app.vault.read(file);
  const next = transform(content);
  if (next === null) {
    new Notice(`${file.basename} has no <!-- jdex:indice --> markers.`);
    return false;
  }
  if (next === content) return false;
  let effect: Effect | null = null;
  await app.vault.process(file, (current) => {
    const updated = transform(current);
    if (updated === null || updated === current) return current;
    effect = { kind: "note-rewrite", path: file.path, before: current, after: updated };
    return updated;
  });
  if (effect) effects?.push(effect);
  return effect !== null;
}
