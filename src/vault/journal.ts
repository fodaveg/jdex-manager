import { type App, TFile, TFolder } from "obsidian";
import { type Effect, type Operation, removeLine } from "../jd/journal";

/**
 * Applies the inverse of each effect, last first. Nothing is deleted outright: notes and folders the
 * plugin created go to the trash (system or `.trash`, as the user prefers), so an edit is recoverable.
 * Returns one line per effect undone; persists removal of each completed inverse so a
 * later failure can be retried without replaying already restored paths.
 */
export async function undoOperation(app: App, op: Operation, onProgress?: () => Promise<void>): Promise<string[]> {
  const done: string[] = [];
  for (let i = op.effects.length - 1; i >= 0; i -= 1) {
    done.push(await undoEffect(app, op.effects[i]));
    op.effects.splice(i, 1);
    await onProgress?.();
  }
  return done;
}

async function undoEffect(app: App, e: Effect): Promise<string> {
  switch (e.kind) {
    case "note-rewrite": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      await app.vault.process(file, (current) => {
        if (current !== e.after) throw new Error(`${e.path} was edited after updating its managed blocks; review manually.`);
        return e.before;
      });
      return `Restored the managed blocks in ${e.path}.`;
    }
    case "created-note": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) return `${e.path} was already gone.`;
      const current = await app.vault.read(file);
      if (current !== e.content) throw new Error(`${e.path} was edited after creation; keep it and review manually.`);
      // Always through the file manager so the user's trash preference is respected.
      await app.fileManager.trashFile(file);
      return `Trashed ${e.path}.`;
    }
    case "trashed-note": {
      if (app.vault.getAbstractFileByPath(e.path)) throw new Error(`${e.path} already exists; cannot restore the duplicate.`);
      await app.vault.create(e.path, e.content);
      return `Restored ${e.path} from the recorded content; the original remains in the trash.`;
    }
    case "created-folder": {
      const folder = app.vault.getAbstractFileByPath(e.path);
      if (!(folder instanceof TFolder)) return `${e.path} was already gone.`;
      const empty = folder.children.length === 0;
      if (!empty) throw new Error(`${e.path} is not empty; keep its content and review manually.`);
      await app.fileManager.trashFile(folder);
      return `Trashed the empty folder ${e.path}.`;
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
        for (const key of e.missingKeys ?? []) delete fm[key];
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
