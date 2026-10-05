/**
 * Rename in pairs: when a JDex note or an ID folder is renamed, what should happen to its partner.
 * Pure; the vault layer performs the rename.
 */

import { relativeTo } from "./detect";
import type { JdIndex } from "./index";
import { extractJdPrefix, jdexNoteName } from "./parse";
import { titleForCompare } from "./title";

export interface RenameEvent {
  oldPath: string;
  newPath: string;
  isFolder: boolean;
}

export type PairAction =
  | { type: "none" }
  /** The number changed: an ID is never renumbered (johnnydecimal.com). Nothing is done. */
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

/** A `+ Title` folder takes its ID number from the parent folder. */
function renamePrefix(path: string, isFolder: boolean): ReturnType<typeof extractJdPrefix> {
  const name = baseName(path);
  if (isFolder && name.startsWith("+ ")) {
    const parent = extractJdPrefix(baseName(parentOf(path)));
    if (!parent || parent.number.kind !== "id" || parent.number.extension) return null;
    return extractJdPrefix(`${parent.number.id}+ ${name.slice(2)}`);
  }
  return extractJdPrefix(name);
}

export function pairAction(
  ev: RenameEvent,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string },
): PairAction {
  const oldParsed = renamePrefix(ev.oldPath, ev.isFolder);
  const newParsed = renamePrefix(ev.newPath, ev.isFolder);
  if (!oldParsed || oldParsed.number.kind !== "id") return { type: "none" };
  if (!newParsed || newParsed.number.kind !== "id") return { type: "none" };
  const oldId = oldParsed.number.id + (oldParsed.number.extension ?? "");
  const newId = newParsed.number.id + (newParsed.number.extension ?? "");
  if (oldId !== newId) return { type: "renumbered", oldId, newId };

  if (ev.isFolder) {
    const oldRel = relativeTo(settings.systemRoot, ev.oldPath);
    const newRel = relativeTo(settings.systemRoot, ev.newPath);
    if (oldRel === null || newRel === null) return { type: "none" };
    const depth = baseName(ev.oldPath).startsWith("+ ") ? 4 : 3;
    if (oldRel.split("/").length !== depth) return { type: "none" };
    if (parentOf(oldRel) !== parentOf(newRel)) return { type: "moved", id: newId, from: parentOf(oldRel), to: parentOf(newRel) };
  } else {
    const oldRel = relativeTo(settings.jdexFolder, ev.oldPath);
    const newRel = relativeTo(settings.jdexFolder, ev.newPath);
    if (oldRel === null || oldRel.includes("/")) return { type: "none" };
    if (newRel === null || newRel.includes("/")) return { type: "none" };
  }

  if (titleForCompare(oldParsed.title) === titleForCompare(newParsed.title)) return { type: "none" };

  // Before or after the rename, the unchanged partner still has the old child title.
  const entry = index.ids.find((e) => e.id === oldId && (!oldId.endsWith("+") || titleForCompare(e.title) === titleForCompare(oldParsed.title)));
  if (!entry) return { type: "none" };
  if (ev.isFolder) {
    if (!entry.notePath) return { type: "none" };
    const notePrefix = extractJdPrefix(baseName(entry.notePath));
    const noteTitle = notePrefix?.title ?? "";
    const tags = noteTitle.slice(titleForCompare(noteTitle).length);
    const newName = jdexNoteName(newId, `${titleForCompare(newParsed.title)}${tags}`, notePrefix?.number.system);
    const newPartnerPath = `${parentOf(entry.notePath)}/${newName}.md`;
    if (newPartnerPath === entry.notePath) return { type: "none" };
    return { type: "rename-partner", id: newId, partnerPath: entry.notePath, newPartnerPath };
  }
  if (!entry.folderPath) return { type: "none" };
  const nestedChild = baseName(entry.folderPath).startsWith("+ ");
  const folderPrefix = extractJdPrefix(baseName(entry.folderPath));
  const newName = nestedChild ? `+ ${titleForCompare(newParsed.title)}` : jdexNoteName(newId, titleForCompare(newParsed.title), folderPrefix?.number.system);
  const newPartnerPath = `${parentOf(entry.folderPath)}/${newName}`;
  if (newPartnerPath === entry.folderPath) return { type: "none" };
  return { type: "rename-partner", id: newId, partnerPath: entry.folderPath, newPartnerPath };
}
