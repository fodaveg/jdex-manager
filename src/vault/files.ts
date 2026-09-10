import { type App, normalizePath, TFile } from "obsidian";
import { type DateFormat, datedName, directFiles, inboxFolders } from "../jd/files";
import type { JdIndex } from "../jd/index";

/** Moves `file` into `folder`, keeping its name (dated when `date` is given). Refuses to overwrite. */
export async function moveInto(app: App, file: TFile, folder: string, date?: { when: Date; format: DateFormat }): Promise<string> {
  const name = date ? datedName(file.name, date.when, date.format) : file.name;
  const target = normalizePath(`${folder}/${name}`);
  if (target === file.path) return target;
  if (app.vault.getAbstractFileByPath(target)) throw new Error(`${target} already exists.`);
  await app.fileManager.renameFile(file, target);
  return target;
}

/** Renames `file` in place with a date prefix taken from its creation time. Returns the new path or null when already dated. */
export async function dateFile(app: App, file: TFile, format: DateFormat): Promise<string | null> {
  const name = datedName(file.name, new Date(file.stat.ctime), format);
  if (name === file.name) return null;
  const target = normalizePath(`${file.parent?.path ?? ""}/${name}`);
  if (app.vault.getAbstractFileByPath(target)) throw new Error(`${target} already exists.`);
  await app.fileManager.renameFile(file, target);
  return target;
}

/** Files waiting in every inbox folder, shallow. */
export function inboxFiles(app: App, index: JdIndex): TFile[] {
  const all = app.vault.getFiles().map((f) => f.path);
  const out: TFile[] = [];
  for (const inbox of inboxFolders(index)) {
    for (const path of directFiles(inbox.folderPath!, all)) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) out.push(f);
    }
  }
  return out;
}
