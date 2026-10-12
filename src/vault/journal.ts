import { type App, type TAbstractFile, TFile, TFolder } from "obsidian";
import { type Effect, frontmatterConflicts, frontmatterUndoState, isKnownEffect, type Operation, removeInsertedLine } from "../jd/journal";
import { frontmatterBlock, readFrontmatter, removeFrontmatterProperty, setFrontmatterProperty } from "./frontmatter-lines";
import { t } from "../ui/i18n";

export interface UndoOptions {
  /** The user confirmed a preview that warned about entries written before 0.5. */
  confirmedLegacy?: boolean;
}

/**
 * Applies the inverse of each effect, last first. Nothing is deleted outright: notes and folders the
 * plugin created go to the trash (system or `.trash`, as the user prefers), so an edit is recoverable.
 * Every inverse checks the live state first and changes nothing when it differs from what the plugin
 * left. Returns one line per effect undone; persists removal of each completed inverse so a later
 * failure can be retried without replaying already restored paths.
 */
export async function undoOperation(app: App, op: Operation, onProgress?: () => Promise<void>, options: UndoOptions = {}): Promise<string[]> {
  const done: string[] = [];
  for (let i = op.effects.length - 1; i >= 0; i -= 1) {
    done.push(await undoEffect(app, op.effects[i], options));
    op.effects.splice(i, 1);
    op.rev = (op.rev ?? 0) + 1;
    await onProgress?.();
  }
  if (op.effects.length === 0 && done.length === 0) await onProgress?.();
  return done;
}

/**
 * The journal entry of a frontmatter correction: only the frontmatter block when nothing else in
 * the note changed (the usual case), the whole note otherwise.
 */
export function frontmatterRewrite(path: string, before: string, after: string): Effect {
  const from = frontmatterBlock(before);
  const to = frontmatterBlock(after);
  if (before.slice(from.length) === after.slice(to.length)) return { kind: "frontmatter-block", path, before: from, after: to };
  return { kind: "note-rewrite", path, before, after };
}

/** First-level child names of a folder, to recognise it after a move. */
export function folderChildren(folder: TFolder): string[] {
  return folder.children.map((child) => child.name).sort();
}

/** What identifies a moved file or folder at undo time; recorded with the `moved` effect. */
export function movedIdentity(target: TAbstractFile): Pick<Extract<Effect, { kind: "moved" }>, "type" | "ctime" | "size" | "children"> {
  if (target instanceof TFile) {
    return {
      type: "file",
      ...(typeof target.stat?.ctime === "number" ? { ctime: target.stat.ctime } : {}),
      ...(typeof target.stat?.size === "number" ? { size: target.stat.size } : {}),
    };
  }
  if (target instanceof TFolder) return { type: "folder", children: folderChildren(target) };
  return {};
}

/**
 * `same`, `different`, or `by-size`: a file whose ctime changed (Android, where ctime follows
 * mtime) but whose path, name and size are the ones recorded. The path and name hold because the
 * target was looked up at the recorded destination.
 */
function sameMovedItem(e: Extract<Effect, { kind: "moved" }>, target: TAbstractFile): "same" | "by-size" | "different" {
  if (!e.type) return "same";
  if (e.type === "file") {
    if (!(target instanceof TFile)) return "different";
    if (e.ctime === undefined || target.stat.ctime === e.ctime) return "same";
    const name = e.to.slice(e.to.lastIndexOf("/") + 1);
    return e.size !== undefined && target.stat.size === e.size && target.name === name ? "by-size" : "different";
  }
  if (!(target instanceof TFolder)) return "different";
  const recorded = e.children ?? [];
  if (recorded.length === 0) return "same";
  const now = new Set(folderChildren(target));
  return recorded.some((name) => now.has(name)) ? "same" : "different";
}

async function undoEffect(app: App, e: Effect, options: UndoOptions): Promise<string> {
  if (!isKnownEffect(e)) throw new Error(t().undoUnknownStep(String((e as { kind?: unknown }).kind)));
  switch (e.kind) {
    case "note-rewrite": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(t().undoNotANote(e.path));
      await app.vault.process(file, (current) => {
        if (current !== e.after) throw new Error(t().undoBlocksEdited(e.path));
        return e.before;
      });
      return t().undoRestoredBlocks(e.path);
    }
    case "frontmatter-block": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(t().undoNotANote(e.path));
      // Only the block is compared and restored: edits to the body since then are kept.
      await app.vault.process(file, (current) => {
        const block = frontmatterBlock(current);
        if (block !== e.after) throw new Error(t().undoFrontmatterEdited(e.path));
        return e.before + current.slice(block.length);
      });
      return t().undoRestoredFrontmatter(e.path);
    }
    case "created-note": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) return t().undoAlreadyGone(e.path);
      const current = await app.vault.read(file);
      if (current !== e.content) throw new Error(t().undoNoteEdited(e.path));
      // Always through the file manager so the user's trash preference is respected.
      await app.fileManager.trashFile(file);
      return t().undoTrashed(e.path);
    }
    case "trashed-note": {
      if (app.vault.getAbstractFileByPath(e.path)) throw new Error(t().undoExistsCannotRestore(e.path));
      await app.vault.create(e.path, e.content);
      return t().undoRestoredNote(e.path);
    }
    case "created-folder": {
      const folder = app.vault.getAbstractFileByPath(e.path);
      if (!(folder instanceof TFolder)) return t().undoAlreadyGone(e.path);
      const empty = folder.children.length === 0;
      if (!empty) throw new Error(t().undoFolderNotEmpty(e.path));
      await app.fileManager.trashFile(folder);
      return t().undoTrashedFolder(e.path);
    }
    case "moved": {
      const target = app.vault.getAbstractFileByPath(e.to);
      if (!target) throw new Error(t().undoNotThere(e.to));
      const identity = sameMovedItem(e, target);
      if (identity === "different") throw new Error(t().undoNotTheItem(e.to));
      if (app.vault.getAbstractFileByPath(e.from)) throw new Error(t().undoExistsAgain(e.from, e.to));
      await app.fileManager.renameFile(target, e.from);
      return identity === "by-size"
        ? t().undoMovedBackBySize(e.to, e.from)
        : t().undoMovedBack(e.to, e.from);
    }
    case "frontmatter": {
      const state = frontmatterUndoState(e);
      if (state === "unknown-keys") throw new Error(t().undoFmUnknownKeys(e.path));
      if (state === "legacy" && !options.confirmedLegacy) throw new Error(t().undoFmLegacy(e.path));
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(t().undoNotANote(e.path));
      // Never `processFrontMatter`: it drops comments and turns `jd: 21.20` into `21.2`. Only the
      // lines of the recorded keys change, inside `process`, and every key is compared before
      // any is touched: a partial restore would leave the step unretryable.
      await app.vault.process(file, (current) => {
        const changed = e.written ? frontmatterConflicts(e.written, readFrontmatter(current) ?? {}) : [];
        if (changed.length > 0) throw new Error(t().undoFmKeysChanged(changed.join(", "), e.path));
        let next: string | null = current;
        for (const [key, value] of Object.entries(e.previous)) {
          if (next === null) break;
          if (value === undefined) next = removeFrontmatterProperty(next, key);
          else if (value === null || typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))) next = setFrontmatterProperty(next, key, value);
          else next = null;
        }
        for (const key of e.missingKeys ?? []) if (next !== null) next = removeFrontmatterProperty(next, key);
        if (next === null) throw new Error(t().undoFmCannotLineByLine(e.path));
        return next;
      });
      return state === "legacy"
        ? t().undoRestoredFmLegacy(e.path)
        : t().undoRestoredFrontmatter(e.path);
    }
    case "line": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(t().undoNotANote(e.path));
      let outcome = "removed" as "removed" | "absent";
      // Inside `process`, so an edit that lands between reading and writing is not overwritten.
      await app.vault.process(file, (content) => {
        const next = removeInsertedLine(content, e.line);
        if ("content" in next) return next.content;
        if (next.missing === "moved") throw new Error(t().undoLineMoved(e.path));
        outcome = "absent";
        return content;
      });
      return outcome === "absent" ? t().undoLineGone(e.path) : t().undoLineRemoved(e.path);
    }
  }
}
