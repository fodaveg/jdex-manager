import { type App, Notice, TFile } from "obsidian";
import { areaCode, type JdIndex } from "../jd/index";
import { jdexNoteName } from "../jd/parse";
import { appendIndexMarkers, renderSystemIndex, replaceSystemIndex } from "../jd/system-index";
import type { JdexManagerSettings } from "../settings";
import { createJdexNote } from "./create";

export interface MissingStructure {
  areas: { number: number; label: string; title: string }[];
  categories: { number: string; areaNumber: number; label: string; title: string }[];
}

export function missingStructureNotes(index: JdIndex): MissingStructure {
  return {
    areas: index.areas.filter((a) => a.path && !a.notePath).map((a) => ({ number: a.number, label: a.label, title: a.title })),
    categories: index.categories
      .filter((c) => c.path && !c.notePath)
      .map((c) => ({ number: c.number, areaNumber: c.areaNumber, label: c.label, title: c.title })),
  };
}

/** Creates the JDex notes of every area and category folder that lacks one. Returns how many were created. */
export async function createMissingStructureNotes(app: App, settings: JdexManagerSettings, index: JdIndex): Promise<number> {
  const missing = missingStructureNotes(index);
  let created = 0;
  for (const a of missing.areas) {
    const code = areaCode(a.number);
    await createJdexNote(app, settings, "area", jdexNoteName(code, a.title), { id: code, title: a.title, area: code, areaTitle: a.label, category: "", categoryTitle: "" });
    created += 1;
  }
  for (const c of missing.categories) {
    const area = index.areas.find((a) => a.number === c.areaNumber);
    await createJdexNote(app, settings, "categoria", jdexNoteName(c.number, c.title), {
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
  const path = settings.systemIndexNote !== "" ? settings.systemIndexNote : index.ids.find((e) => e.id === "00.00")?.notePath;
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

/** Regenerates the block between the index markers; adds the markers at the end when missing. */
export async function updateSystemIndex(app: App, settings: JdexManagerSettings, index: JdIndex, addMarkers: boolean): Promise<boolean> {
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
  let content = await app.vault.read(file);
  let next = replaceSystemIndex(content, renderSystemIndex(index, descriptions));
  if (next === null) {
    if (!addMarkers) {
      new Notice(`${file.basename} has no <!-- jdex:indice --> markers.`);
      return false;
    }
    content = appendIndexMarkers(content);
    next = replaceSystemIndex(content, renderSystemIndex(index, descriptions));
  }
  if (next === null || next === content) return false;
  await app.vault.modify(file, next);
  return true;
}
