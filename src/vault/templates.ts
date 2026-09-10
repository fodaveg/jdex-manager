import { type App, normalizePath, TFile } from "obsidian";
import { BUILTIN_TEMPLATES, TEMPLATE_TYPES } from "../jd/template";
import type { JdexManagerSettings, JdexNoteType } from "../settings";

/** Vault path of the user's template note for `type`, or null when no templates folder is set. */
export function templatePath(settings: JdexManagerSettings, type: JdexNoteType): string | null {
  if (settings.templatesFolder === "") return null;
  return normalizePath(`${settings.templatesFolder}/${settings.templateNames[type]}.md`);
}

/** The template text for `type`: the user's note in the templates folder if it exists, else the built-in. */
export async function resolveTemplate(app: App, settings: JdexManagerSettings, type: JdexNoteType): Promise<string> {
  const path = templatePath(settings, type);
  if (path) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return app.vault.read(file);
  }
  return BUILTIN_TEMPLATES[type];
}

/**
 * Writes the four built-in templates into the templates folder so the user can edit them.
 * Existing notes are never overwritten. Returns how many were created and how many skipped.
 */
export async function writeBuiltinTemplates(
  app: App,
  settings: JdexManagerSettings,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const type of TEMPLATE_TYPES) {
    const path = templatePath(settings, type);
    if (!path) break;
    if (app.vault.getAbstractFileByPath(path)) {
      skipped += 1;
      continue;
    }
    await app.vault.create(path, BUILTIN_TEMPLATES[type]);
    created += 1;
  }
  return { created, skipped };
}
