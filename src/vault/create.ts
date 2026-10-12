import { type App, normalizePath, TFile, TFolder } from "obsidian";
import { renderTemplate, type TemplateVars, todayIso } from "../jd/template";
import type { JdexManagerSettings, JdexNoteType } from "../settings";
import { extractJdPrefix } from "../jd/parse";
import { findId, childrenPlus } from "../jd/index";
import { titleForCompare } from "../jd/title";
import { scanVault } from "./scan";
import { resolveTemplate } from "./templates";
import type { Effect } from "../jd/journal";

/** Creates `jdexFolder/<name>.md` from the template of `type`. Refuses to overwrite. Records the note in `effects`. */
export async function createJdexNote(
  app: App,
  settings: JdexManagerSettings,
  type: JdexNoteType,
  name: string,
  vars: Partial<TemplateVars>,
  extra = "",
  effects?: Effect[],
): Promise<TFile> {
  const path = normalizePath(`${settings.jdexFolder}/${name}.md`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`${path} already exists.`);
  // Never recreate a renamed or deleted JDex folder (empty) at its old path.
  if (settings.jdexFolder !== "" && !(app.vault.getAbstractFileByPath(normalizePath(settings.jdexFolder)) instanceof TFolder)) {
    throw new Error(`The JDex folder (${settings.jdexFolder}) does not exist. Check the plugin settings; nothing was created.`);
  }
  const template = await resolveTemplate(app, settings, type, { category: vars.category || undefined, area: vars.area || undefined });
  const content = renderTemplate(template, { date: todayIso(), ...vars }) + extra;
  const parsed = extractJdPrefix(name);
  if (parsed?.number.kind === "id") {
    const index = scanVault(app, settings);
    const number = parsed.number;
    const existing = number.extension
      ? childrenPlus(index, number.id, number.system).find((entry) => titleForCompare(entry.title) === titleForCompare(parsed.title))
      : findId(index, number.id, number.system);
    if (existing) throw new Error(`${name}: number already used by ${existing.label}.`);
  } else if (parsed?.number.kind === "category" || parsed?.number.kind === "area") {
    // Categories and areas: the same number under another title is the same identity.
    const index = scanVault(app, settings);
    const number = parsed.number;
    const system = number.system ?? "";
    const existing = number.kind === "category"
      ? index.categories.find((entry) => entry.number === number.category && (entry.system ?? "") === system)
      : index.areas.find((entry) => entry.number === number.area && (entry.system ?? "") === system);
    if (existing) throw new Error(`${name}: number already used by ${existing.label}.`);
  }
  const note = await app.vault.create(path, content);
  effects?.push({ kind: "created-note", path, content });
  return note;
}

/** Creates a folder unless it exists. Throws when the path is a file. Returns whether it was created; records it in `effects`. */
export async function ensureFolder(app: App, path: string, effects?: Effect[]): Promise<boolean> {
  const p = normalizePath(path);
  const present = app.vault.getAbstractFileByPath(p);
  if (present instanceof TFolder) return false;
  if (present instanceof TFile) throw new Error(`${p} exists and is a file.`);
  await app.vault.createFolder(p);
  effects?.push({ kind: "created-folder", path: p });
  return true;
}
