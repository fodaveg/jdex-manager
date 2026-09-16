import { type App, TFile, TFolder } from "obsidian";
import { type Effect, type Operation, removeLine } from "../jd/journal";

/**
 * Applies the inverse of each effect, last first. Nothing is deleted outright: notes and folders the
 * plugin created go to the trash (system or `.trash`, as the user prefers), so an edit is recoverable.
 * Returns one line per effect undone; throws on the first effect that cannot be undone.
 */
export async function undoOperation(app: App, op: Operation): Promise<string[]> {
  const done: string[] = [];
  for (const effect of [...op.effects].reverse()) done.push(await undoEffect(app, effect));
  return done;
}

async function undoEffect(app: App, e: Effect): Promise<string> {
  switch (e.kind) {
    case "created-note": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) return `${e.path} was already gone.`;
      const current = await app.vault.read(file);
      // Always through the file manager so the user's trash preference is respected.
      await app.fileManager.trashFile(file);
      return current === e.content ? `Trashed ${e.path}.` : `${e.path} had been edited: trashed anyway, recover it from the trash if needed.`;
    }
    case "created-folder": {
      const folder = app.vault.getAbstractFileByPath(e.path);
      if (!(folder instanceof TFolder)) return `${e.path} was already gone.`;
      const empty = folder.children.length === 0;
      await app.fileManager.trashFile(folder);
      return empty ? `Trashed the empty folder ${e.path}.` : `${e.path} was not empty: trashed with its content, recover it from the trash if needed.`;
    }
    case "moved": {
      const target = app.vault.getAbstractFileByPath(e.to);
      if (!target) throw new Error(`${e.to} is not there any more; nothing to move back.`);
      if (app.vault.getAbstractFileByPath(e.from)) throw new Error(`${e.from} exists again; cannot move ${e.to} back.`);
      await app.fileManager.renameFile(target, e.from);
      return `Moved ${e.to} back to ${e.from}.`;
    }
    case "frontmatter": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(e.previous)) {
          if (value === undefined) delete fm[key];
          else fm[key] = value;
        }
      });
      return `Restored the frontmatter of ${e.path}.`;
    }
    case "line": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      const content = await app.vault.read(file);
      const next = removeLine(content, e.line);
      if (next === null) return `The line was already gone from ${e.path}.`;
      await app.vault.modify(file, next);
      return `Removed the line from ${e.path}.`;
    }
  }
}

/** Frontmatter values before `set` is applied, so the change can be undone. */
export function previousFrontmatter(app: App, file: TFile, keys: string[]): Record<string, unknown> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = fm[key];
  return previous;
}
