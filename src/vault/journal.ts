import { type App, type TAbstractFile, TFile, TFolder } from "obsidian";
import { type Effect, frontmatterConflicts, frontmatterUndoState, isKnownEffect, type Operation, removeInsertedLine } from "../jd/journal";
import { frontmatterBlock, readFrontmatter, removeFrontmatterProperty, setFrontmatterProperty } from "./frontmatter-lines";

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
  if (!isKnownEffect(e)) throw new Error(`a step of kind "${String((e as { kind?: unknown }).kind)}" comes from another version of the plugin and cannot be undone here`);
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
    case "frontmatter-block": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      // Only the block is compared and restored: edits to the body since then are kept.
      await app.vault.process(file, (current) => {
        const block = frontmatterBlock(current);
        if (block !== e.after) throw new Error(`the frontmatter of ${e.path} was edited after the operation; nothing was restored, review manually`);
        return e.before + current.slice(block.length);
      });
      return `Restored the frontmatter of ${e.path}.`;
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
      const identity = sameMovedItem(e, target);
      if (identity === "different") throw new Error(`${e.to} is not the item that was moved there; review manually.`);
      if (app.vault.getAbstractFileByPath(e.from)) throw new Error(`${e.from} exists again; cannot move ${e.to} back.`);
      await app.fileManager.renameFile(target, e.from);
      return identity === "by-size"
        ? `Moved ${e.to} back to ${e.from}. Its creation time changed after the move (as on Android); it was recognised by its path, name and size.`
        : `Moved ${e.to} back to ${e.from}.`;
    }
    case "frontmatter": {
      const state = frontmatterUndoState(e);
      if (state === "unknown-keys") throw new Error(`the frontmatter step of ${e.path} comes from an older version that did not keep which keys it added; review manually or discard the entry`);
      if (state === "legacy" && !options.confirmedLegacy) throw new Error(`the frontmatter step of ${e.path} comes from an older version; confirm its undo explicitly`);
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      // Never `processFrontMatter`: it drops comments and turns `jd: 21.20` into `21.2`. Only the
      // lines of the recorded keys change, inside `process`, and every key is compared before
      // any is touched: a partial restore would leave the step unretryable.
      await app.vault.process(file, (current) => {
        const changed = e.written ? frontmatterConflicts(e.written, readFrontmatter(current) ?? {}) : [];
        if (changed.length > 0) throw new Error(`${changed.join(", ")} in ${e.path} changed after the operation; nothing was restored, review manually`);
        let next: string | null = current;
        for (const [key, value] of Object.entries(e.previous)) {
          if (next === null) break;
          if (value === undefined) next = removeFrontmatterProperty(next, key);
          else if (value === null || typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))) next = setFrontmatterProperty(next, key, value);
          else next = null;
        }
        for (const key of e.missingKeys ?? []) if (next !== null) next = removeFrontmatterProperty(next, key);
        if (next === null) throw new Error(`the frontmatter of ${e.path} cannot be restored line by line (a repeated key, an unusual format or a value that is not text); nothing was restored, review manually`);
        return next;
      });
      return state === "legacy"
        ? `Restored the frontmatter of ${e.path} from an older entry; check it for keys the old version did not record.`
        : `Restored the frontmatter of ${e.path}.`;
    }
    case "line": {
      const file = app.vault.getAbstractFileByPath(e.path);
      if (!(file instanceof TFile)) throw new Error(`${e.path} is not a note any more.`);
      let outcome = "removed" as "removed" | "absent";
      // Inside `process`, so an edit that lands between reading and writing is not overwritten.
      await app.vault.process(file, (content) => {
        const next = removeInsertedLine(content, e.line);
        if ("content" in next) return next.content;
        if (next.missing === "moved") throw new Error(`the line in ${e.path} is no longer where it was inserted; review manually`);
        outcome = "absent";
        return content;
      });
      return outcome === "absent" ? `The line was already gone from ${e.path}.` : `Removed the line from ${e.path}.`;
    }
  }
}
