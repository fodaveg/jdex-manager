/**
 * Rename in pairs: when a JDex note or an ID folder is renamed, what should happen to its partner.
 * Pure; the vault layer performs the rename.
 */

import { relativeTo } from "./detect";
import { isRepeatedId, sameSystem, systemKey, type JdIndex } from "./index";
import { extractJdPrefix, jdexNoteName, type JdNumber } from "./parse";
import { titleForCompare } from "./title";

export interface RenameEvent {
  oldPath: string;
  newPath: string;
  isFolder: boolean;
}

export type PairAction =
  | { type: "none" }
  /** The number changed: an ID is never renumbered (johnnydecimal.com). Nothing is done. */
  | { type: "unnumbered"; oldId: string }
  | { type: "renumbered"; oldId: string; newId: string }
  /** An ID folder or note moved to another category or area. Nothing is done. */
  | { type: "moved"; id: string; from: string; to: string }
  /** The title changed: the partner should follow. */
  | { type: "rename-partner"; id: string; partnerPath: string; newPartnerPath: string };

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Full identity of a path segment (area, category or ID, with its system); titles never count. */
function segmentIdentity(segment: string): string {
  const parsed = extractJdPrefix(segment);
  if (!parsed) return `raw:${segment}`;
  const n: JdNumber = parsed.number;
  const value = n.kind === "area" ? String(n.area) : n.kind === "category" ? n.category : n.id + (n.extension ?? "");
  return `${n.kind}:${systemKey(value, n.system)}`;
}

/** Same chain of areas, categories and IDs, whatever their titles: a renamed parent is not a move. */
function sameParentIdentity(oldParent: string, newParent: string): boolean {
  const left = oldParent.split("/");
  const right = newParent.split("/");
  return left.length === right.length && left.every((segment, i) => segmentIdentity(segment) === segmentIdentity(right[i]));
}

/** A `+ Title` folder takes its ID number from the parent folder. */
function renamePrefix(path: string, isFolder: boolean): ReturnType<typeof extractJdPrefix> {
  const name = baseName(path);
  if (isFolder && name.startsWith("+ ")) {
    const parent = extractJdPrefix(baseName(parentOf(path)));
    if (!parent || parent.number.kind !== "id" || parent.number.extension) return null;
    return extractJdPrefix(`${systemKey(parent.number.id, parent.number.system)}+ ${name.slice(2)}`);
  }
  return extractJdPrefix(name);
}

export function pairAction(
  ev: RenameEvent,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string },
): PairAction {
  const resolved = resolvePair(ev, index, settings);
  return "repeated" in resolved ? { type: "none" } : resolved;
}

/** Whether `pairAction` proposed nothing only because the number is repeated (two notes or folders
 *  share it, so "the" partner could be the other ID's). The caller can then say why. */
export function pairBlockedByRepeat(
  ev: RenameEvent,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string },
): boolean {
  return "repeated" in resolvePair(ev, index, settings);
}

function resolvePair(
  ev: RenameEvent,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string },
): PairAction | { repeated: true } {
  const oldRelative = relativeTo(ev.isFolder ? settings.systemRoot : settings.jdexFolder, ev.oldPath);
  if (oldRelative === null || (!ev.isFolder && oldRelative.includes("/"))) return { type: "none" };
  if (ev.isFolder && oldRelative.split("/").length !== (baseName(ev.oldPath).startsWith("+ ") ? 4 : 3)) return { type: "none" };
  const oldParsed = renamePrefix(ev.oldPath, ev.isFolder);
  const newParsed = renamePrefix(ev.newPath, ev.isFolder);
  if (!oldParsed || oldParsed.number.kind !== "id") return { type: "none" };
  const oldId = systemKey(oldParsed.number.id + (oldParsed.number.extension ?? ""), oldParsed.number.system);
  if (!newParsed || newParsed.number.kind !== "id") return { type: "unnumbered", oldId };
  const newId = systemKey(newParsed.number.id + (newParsed.number.extension ?? ""), newParsed.number.system);
  if (oldId !== newId) return { type: "renumbered", oldId, newId };

  if (ev.isFolder) {
    const oldRel = relativeTo(settings.systemRoot, ev.oldPath);
    const newRel = relativeTo(settings.systemRoot, ev.newPath);
    if (oldRel === null || newRel === null) return { type: "none" };
    const depth = baseName(ev.oldPath).startsWith("+ ") ? 4 : 3;
    if (oldRel.split("/").length !== depth) return { type: "none" };
    if (!sameParentIdentity(parentOf(oldRel), parentOf(newRel))) return { type: "moved", id: newId, from: parentOf(oldRel), to: parentOf(newRel) };
  } else {
    const oldRel = relativeTo(settings.jdexFolder, ev.oldPath);
    const newRel = relativeTo(settings.jdexFolder, ev.newPath);
    if (oldRel === null || oldRel.includes("/")) return { type: "none" };
    if (newRel === null || newRel.includes("/")) return { type: "none" };
  }

  if (titleForCompare(oldParsed.title) === titleForCompare(newParsed.title)) return { type: "none" };

  // Before or after the rename, the unchanged partner still has the old child title.
  const entry = index.ids.find((e) => e.id === (oldParsed.number.kind === "id" ? oldParsed.number.id + (oldParsed.number.extension ?? "") : "") && sameSystem(e, oldParsed.number) && (!oldId.endsWith("+") || titleForCompare(e.title) === titleForCompare(oldParsed.title)));
  if (!entry) return { type: "none" };
  // Two notes or folders share this number: `find` took the first, which may be the other ID.
  if (isRepeatedId(index, entry)) return { repeated: true };
  if (ev.isFolder) {
    if (!entry.notePath) return { type: "none" };
    const notePrefix = extractJdPrefix(baseName(entry.notePath));
    const noteTitle = notePrefix?.title ?? "";
    const tags = noteTitle.slice(titleForCompare(noteTitle).length);
    const newName = jdexNoteName(newParsed.number.id + (newParsed.number.extension ?? ""), `${titleForCompare(newParsed.title)}${tags}`, notePrefix?.number.system);
    const newPartnerPath = `${parentOf(entry.notePath)}/${newName}.md`;
    if (newPartnerPath === entry.notePath) return { type: "none" };
    return { type: "rename-partner", id: newId, partnerPath: entry.notePath, newPartnerPath };
  }
  if (!entry.folderPath) return { type: "none" };
  const nestedChild = baseName(entry.folderPath).startsWith("+ ");
  const folderPrefix = extractJdPrefix(baseName(entry.folderPath));
  // A `+` child with nothing left of its title would be named `+` alone: no proposal.
  if (nestedChild && titleForCompare(newParsed.title) === "") return { type: "none" };
  const newName = nestedChild ? jdexNoteName("+", titleForCompare(newParsed.title)) : jdexNoteName(newParsed.number.id + (newParsed.number.extension ?? ""), titleForCompare(newParsed.title), folderPrefix?.number.system);
  const newPartnerPath = `${parentOf(entry.folderPath)}/${newName}`;
  if (newPartnerPath === entry.folderPath) return { type: "none" };
  return { type: "rename-partner", id: newId, partnerPath: entry.folderPath, newPartnerPath };
}

/** The pair actions that change an ID's number or place: both hosts warn about these. */
export type RenumberAction = Extract<PairAction, { type: "unnumbered" } | { type: "renumbered" } | { type: "moved" }>;

/** Language of a message the engine words for a host's interface. */
export type MessageLanguage = "es" | "en";

/**
 * The single wording of the «never renumber» warning, shared by both hosts so neither drifts.
 * `would`: asked before the change is written; `did`: told after it happened. Each host adds its
 * own ending (a question, a clickable «Deshacer», or where to undo it).
 */
export function renumberMessage(action: RenumberAction, tense: "would" | "did", language: MessageLanguage = "es"): string {
  const would = tense === "would";
  if (language === "en") {
    if (action.type === "unnumbered") return `${action.oldId} ${would ? "would lose" : "lost"} its number: an ID is never renumbered (johnnydecimal.com).`;
    if (action.type === "renumbered") return `${action.oldId} ${would ? "would become" : "became"} ${action.newId}: an ID is never renumbered (johnnydecimal.com).`;
    return `${action.id} ${would ? "would move" : "moved"} to another category or area, from ${action.from} to ${action.to}.`;
  }
  if (action.type === "unnumbered") return `«${action.oldId}» ${would ? "perdería" : "ha perdido"} su número: un ID nunca se renumera (johnnydecimal.com).`;
  if (action.type === "renumbered") return `«${action.oldId}» ${would ? "pasaría" : "ha pasado"} a «${action.newId}»: un ID nunca se renumera (johnnydecimal.com).`;
  return `«${action.id}» ${would ? "cambiaría" : "ha cambiado"} de categoría o área, de «${action.from}» a «${action.to}».`;
}
