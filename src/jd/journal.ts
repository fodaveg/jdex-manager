/**
 * Journal of what the plugin did, so the last operation can be undone.
 * Pure: effects are recorded by the vault layer and inverted by it; this module only keeps the
 * list, describes an undo, merges two copies of the list and trims it. No Obsidian imports.
 */

export type Effect =
  /** A managed block update, guarded against later body edits at undo time. */
  | { kind: "note-rewrite"; path: string; before: string; after: string }
  /**
   * A frontmatter correction: only the frontmatter block before and after (delimiters included,
   * `""` when there was none). Undo compares and restores that block alone, so later edits to
   * the body do not block it.
   */
  | { kind: "frontmatter-block"; path: string; before: string; after: string }
  /** A note the plugin wrote, with the content it wrote (to tell "untouched" from "edited" at undo time). */
  | { kind: "created-note"; path: string; content: string }
  /** Exact bytes of a duplicate conflict note sent to trash, for guarded recreation. */
  | { kind: "trashed-note"; path: string; content: string }
  | { kind: "created-folder"; path: string }
  /**
   * A rename or move. `type`, `ctime` (files) and `children` (folders, first level) identify what
   * was moved, so undo does not move back another item that reused the path. Older entries lack them.
   */
  | { kind: "moved"; from: string; to: string; type?: "file" | "folder"; ctime?: number; children?: string[] }
  /**
   * Prior values plus absent keys, which must survive JSON dropping `undefined`. `written` holds the
   * values the plugin wrote: undo compares every key against them before touching the note.
   * Entries written before 0.5 have no `written`.
   */
  | { kind: "frontmatter"; path: string; previous: Record<string, unknown>; missingKeys?: string[]; written?: Record<string, unknown> }
  /** A line the plugin inserted after the first H1 (or after the frontmatter when there is no H1). */
  | { kind: "line"; path: string; line: string };

export type OperationKind = "create-id" | "create-structure" | "retire" | "move" | "fix";

export interface Operation<E = Effect> {
  kind: OperationKind;
  /** `Create 21.23 Prueba`, `Retire 21.22`, `Move x.md to 21.22` … */
  label: string;
  /** ISO date-time. */
  at: string;
  effects: E[];
  /** Stable identity of the operation. Entries written before 0.5 get one from `withJournalIds`. */
  id?: string;
  /** Device that made the operation. Absent in entries written before 0.5. */
  device?: string;
  /** Bumped on every change of `effects`, so a merge keeps the newest copy of the same operation. */
  rev?: number;
}

export const JOURNAL_MAX = 20;
/** Version of the stored journal format. 0.3.x and 0.4.x stored no version. */
export const JOURNAL_VERSION = 2;
/** How many identities of removed operations a merge remembers. */
export const JOURNAL_REMOVED_MAX = 100;

/** Encodes absent frontmatter keys explicitly so a saved journal can remove them at undo. */
export function durableEffect(effect: Effect): Effect {
  if (effect.kind !== "frontmatter") return effect;
  const missingKeys = [...new Set([...(effect.missingKeys ?? []), ...Object.keys(effect.previous).filter((key) => effect.previous[key] === undefined)])];
  return missingKeys.length > 0 ? { ...effect, missingKeys } : effect;
}

/** Appends `op` and keeps the last `max` operations. Empty operations are not recorded. */
export function pushOperation<E>(journal: Operation<E>[], op: Operation<E>, max = JOURNAL_MAX): Operation<E>[] {
  if (op.effects.length === 0) return journal;
  const next = [...journal, op];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** A new operation or device identity. Not cryptographic: it only has to be unique per journal. */
export function newJournalId(now: number = Date.now(), random: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 3; i += 1) tail += Math.floor(random() * 0x100000000).toString(36).padStart(7, "0");
  return `${now.toString(36)}-${tail}`;
}

/** Identity of an operation; entries from before 0.5 derive it from their date and label, so two devices agree. */
export function journalOperationId<E>(op: Operation<E>): string {
  return op.id ?? `legacy:${op.at}:${op.label}`;
}

/** Gives every operation its identity, keeping the ones it already has. */
export function withJournalIds<E>(ops: Operation<E>[]): Operation<E>[] {
  return ops.map((op) => (op.id ? op : { ...op, id: journalOperationId(op) }));
}

export interface JournalState<E = Effect> {
  entries: Operation<E>[];
  /** Identities of operations undone or discarded, so a merge does not bring them back. */
  removed: string[];
}

/**
 * Joins two copies of the journal (this device's and the stored one, which another device or
 * window may have written) by identity, never by position:
 * - an operation removed in either copy (undone or discarded) stays removed;
 * - an operation present in both keeps the copy with the higher `rev` (this device's on a tie);
 * - operations without effects are dropped;
 * - the result is ordered by date (operations of the same instant keep this device's order) and
 *   keeps the last `max`.
 * Undo always targets the last operation, and refuses one made on another device, so the merged
 * order never makes a device undo past an operation it did not make.
 */
export function mergeJournals<E>(local: JournalState<E>, stored: JournalState<E>, max = JOURNAL_MAX): JournalState<E> {
  const removed = [...new Set([...stored.removed, ...local.removed])].slice(-JOURNAL_REMOVED_MAX);
  const gone = new Set(removed);
  // This device's order first: the sort below is stable, so operations of the same instant keep it.
  const byId = new Map<string, Operation<E>>();
  for (const op of withJournalIds(local.entries)) if (!gone.has(op.id!)) byId.set(op.id!, op);
  for (const op of withJournalIds(stored.entries)) {
    if (gone.has(op.id!)) continue;
    const mine = byId.get(op.id!);
    if (!mine || (op.rev ?? 0) > (mine.rev ?? 0)) byId.set(op.id!, op);
  }
  const entries = [...byId.values()]
    .filter((op) => Array.isArray(op.effects) && op.effects.length > 0)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (entries.length <= max) return { entries, removed };
  // What falls off the end is remembered as removed, so an older copy does not bring it back.
  const evicted = entries.slice(0, entries.length - max).map((op) => op.id!);
  return { entries: entries.slice(entries.length - max), removed: [...removed, ...evicted].slice(-JOURNAL_REMOVED_MAX) };
}

/** Appends `op` like `pushOperation` and returns the identities that fell off the end. */
export function appendOperation<E>(state: JournalState<E>, op: Operation<E>, max = JOURNAL_MAX): JournalState<E> {
  const next = [...state.entries, op];
  if (next.length <= max) return { entries: next, removed: state.removed };
  const evicted = next.slice(0, next.length - max).map((entry) => journalOperationId(entry));
  return { entries: next.slice(next.length - max), removed: [...state.removed, ...evicted].slice(-JOURNAL_REMOVED_MAX) };
}

const KNOWN_EFFECTS = new Set(["note-rewrite", "frontmatter-block", "created-note", "trashed-note", "created-folder", "moved", "frontmatter", "line"]);

/** True for an effect kind this version knows how to undo. */
export function isKnownEffect(effect: { kind?: unknown }): boolean {
  return typeof effect?.kind === "string" && KNOWN_EFFECTS.has(effect.kind);
}

/**
 * How safely a frontmatter effect can be undone:
 * - `exact`: it knows what it wrote and compares every key first;
 * - `legacy`: written before 0.5, it cannot see later edits and may have lost added keys;
 * - `unknown-keys`: an old entry whose keys were all lost when saved; it cannot be undone.
 */
export function frontmatterUndoState(effect: Extract<Effect, { kind: "frontmatter" }>): "exact" | "legacy" | "unknown-keys" {
  if (effect.written) return "exact";
  const keys = Object.keys(effect.previous ?? {}).length + (effect.missingKeys?.length ?? 0);
  return keys === 0 ? "unknown-keys" : "legacy";
}

/** Keys whose current value is not the value the plugin wrote: undo must not touch the note. */
export function frontmatterConflicts(written: Record<string, unknown>, current: Record<string, unknown>): string[] {
  return Object.keys(written).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(written[key]));
}

/** Lines the undo preview must show before anything runs: old entries and steps this version cannot undo. */
export function undoWarnings(op: Operation): string[] {
  const out: string[] = [];
  for (const e of op.effects) {
    if (!isKnownEffect(e)) out.push(`A step of kind "${String((e as { kind?: unknown }).kind)}" comes from another version and cannot be undone here; the entry stays in the journal.`);
    else if (e.kind === "frontmatter") {
      const state = frontmatterUndoState(e);
      if (state === "unknown-keys") out.push(`The frontmatter step of ${e.path} comes from an older version that did not keep which keys it added; it cannot be undone and the entry stays in the journal.`);
      else if (state === "legacy") out.push(`The frontmatter step of ${e.path} comes from an older version: later edits to those keys cannot be detected and keys it added may remain. Confirm only after checking the note.`);
    } else if (e.kind === "moved" && !e.type) out.push(`The move of ${e.to} comes from an older version and cannot check that it is the same item.`);
  }
  return out;
}

/** One line per effect, in the order the undo will run (last effect first). */
export function describeUndo(op: Operation): string[] {
  const lines: string[] = [];
  for (const e of [...op.effects].reverse()) {
    switch (e.kind) {
      case "note-rewrite":
        lines.push(`Restore the managed blocks in ${e.path}.`);
        break;
      case "frontmatter-block":
        lines.push(`Restore the frontmatter of ${e.path}.`);
        break;
      case "created-note":
        lines.push(`Move ${e.path} to the trash.`);
        break;
      case "trashed-note":
        lines.push(`Restore the trashed note ${e.path}.`);
        break;
      case "created-folder":
        lines.push(`Move the folder ${e.path} to the trash.`);
        break;
      case "moved":
        lines.push(`Move ${e.to} back to ${e.from}.`);
        break;
      case "frontmatter": {
        const keys = [...new Set([...Object.keys(e.previous ?? {}), ...(e.missingKeys ?? [])])];
        lines.push(keys.length > 0 ? `Restore ${keys.join(", ")} in the frontmatter of ${e.path}.` : `Restore the frontmatter of ${e.path} (keys unknown).`);
        break;
      }
      case "line":
        lines.push(`Remove the line "${e.line}" from ${e.path}.`);
        break;
      default:
        lines.push(`Unknown step "${String((e as { kind?: unknown }).kind)}": this version cannot undo it.`);
    }
  }
  return lines;
}

/** Removes the first line equal to `line`. Returns null when the line is not there. */
export function removeLine(content: string, line: string): string | null {
  const lines = content.split("\n");
  const i = lines.indexOf(line);
  if (i === -1) return null;
  lines.splice(i, 1);
  // The plugin inserted the line with a blank line after it; drop that too when it is still there.
  if (lines[i] === "" && (i === 0 || lines[i - 1] === "")) lines.splice(i, 1);
  return lines.join("\n");
}

/**
 * Removes `line` only where `insertAfterH1` put it: right after the first H1 below the frontmatter,
 * or right after the frontmatter when the note has no H1. `missing` is `absent` when the line is
 * nowhere and `moved` when it is somewhere else (the user moved or copied it: leave it).
 */
export function removeInsertedLine(content: string, line: string): { content: string } | { missing: "absent" | "moved" } {
  const lines = content.split("\n");
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end !== -1) start = end + 1;
  }
  let at = start;
  for (let k = start; k < lines.length; k += 1) {
    if (/^#\s/.test(lines[k])) {
      at = k + 1;
      break;
    }
  }
  if (lines[at] === line) {
    lines.splice(at, 1);
    return { content: lines.join("\n") };
  }
  return { missing: lines.includes(line) ? "moved" : "absent" };
}
