/**
 * Journal of what the plugin did, so the last operation can be undone.
 * Pure: effects are recorded by the vault layer and inverted by it; this module only keeps the
 * list, describes an undo and trims it. No Obsidian imports.
 */

export type Effect =
  /** A managed block update, guarded against later body edits at undo time. */
  | { kind: "note-rewrite"; path: string; before: string; after: string }
  /** A note the plugin wrote, with the content it wrote (to tell "untouched" from "edited" at undo time). */
  | { kind: "created-note"; path: string; content: string }
  /** Exact bytes of a duplicate conflict note sent to trash, for guarded recreation. */
  | { kind: "trashed-note"; path: string; content: string }
  | { kind: "created-folder"; path: string }
  | { kind: "moved"; from: string; to: string }
  /** Prior values plus absent keys, which must survive JSON dropping `undefined`. */
  | { kind: "frontmatter"; path: string; previous: Record<string, unknown>; missingKeys?: string[] }
  /** A line the plugin inserted into a note. */
  | { kind: "line"; path: string; line: string };

export type OperationKind = "create-id" | "create-structure" | "retire" | "move" | "fix";

export interface Operation<E = Effect> {
  kind: OperationKind;
  /** `Create 21.23 Prueba`, `Retire 21.22`, `Move x.md to 21.22` … */
  label: string;
  /** ISO date-time. */
  at: string;
  effects: E[];
}

export const JOURNAL_MAX = 20;

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

/** One line per effect, in the order the undo will run (last effect first). */
export function describeUndo(op: Operation): string[] {
  const lines: string[] = [];
  for (const e of [...op.effects].reverse()) {
    switch (e.kind) {
      case "note-rewrite":
        lines.push(`Restore the managed blocks in ${e.path}.`);
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
        const keys = [...new Set([...Object.keys(e.previous), ...(e.missingKeys ?? [])])];
        lines.push(`Restore ${keys.join(", ")} in the frontmatter of ${e.path}.`);
        break;
      }
      case "line":
        lines.push(`Remove the line "${e.line}" from ${e.path}.`);
        break;
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
