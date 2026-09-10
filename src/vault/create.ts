import { type App, normalizePath, TFile, TFolder } from "obsidian";
import { renderTemplate, type TemplateVars, todayIso } from "../jd/template";
import type { JdexManagerSettings, JdexNoteType } from "../settings";
import { resolveTemplate } from "./templates";

/** Creates `jdexFolder/<name>.md` from the template of `type`. Refuses to overwrite. */
export async function createJdexNote(
  app: App,
  settings: JdexManagerSettings,
  type: JdexNoteType,
  name: string,
  vars: Partial<TemplateVars>,
  extra = "",
): Promise<TFile> {
  const path = normalizePath(`${settings.jdexFolder}/${name}.md`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`${path} already exists.`);
  const template = await resolveTemplate(app, settings, type);
  const content = renderTemplate(template, { date: todayIso(), ...vars }) + extra;
  return app.vault.create(path, content);
}

/** Creates a folder unless it exists. Throws when the path is a file. Returns whether it was created. */
export async function ensureFolder(app: App, path: string): Promise<boolean> {
  const p = normalizePath(path);
  const present = app.vault.getAbstractFileByPath(p);
  if (present instanceof TFolder) return false;
  if (present instanceof TFile) throw new Error(`${p} exists and is a file.`);
  await app.vault.createFolder(p);
  return true;
}
