/**
 * Rename in pairs: when a JDex note or an ID folder is renamed, what should happen to its partner.
 * Pure; the vault layer performs the rename.
 */

import { relativeTo } from "./detect";
import type { JdIndex } from "./index";
import { extractJdPrefix } from "./parse";

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

export function pairAction(
  ev: RenameEvent,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string },
): PairAction {
  const oldParsed = extractJdPrefix(baseName(ev.oldPath));
  const newParsed = extractJdPrefix(baseName(ev.newPath));
  if (!oldParsed || oldParsed.number.kind !== "id") return { type: "none" };
  if (!newParsed || newParsed.number.kind !== "id") return { type: "none" };
  const oldId = oldParsed.number.id + (oldParsed.number.extension ?? "");
  const newId = newParsed.number.id + (newParsed.number.extension ?? "");
  if (oldId !== newId) return { type: "renumbered", oldId, newId };

  if (ev.isFolder) {
    const oldRel = relativeTo(settings.systemRoot, ev.oldPath);
    const newRel = relativeTo(settings.systemRoot, ev.newPath);
    if (oldRel === null || newRel === null) return { type: "none" };
    if (oldRel.split("/").length !== 3) return { type: "none" };
    if (parentOf(oldRel) !== parentOf(newRel)) return { type: "moved", id: newId, from: parentOf(oldRel), to: parentOf(newRel) };
  } else {
    const oldRel = relativeTo(settings.jdexFolder, ev.oldPath);
    const newRel = relativeTo(settings.jdexFolder, ev.newPath);
    if (oldRel === null || oldRel.includes("/")) return { type: "none" };
    if (newRel === null || newRel.includes("/")) return { type: "none" };
  }

  if (oldParsed.title === newParsed.title) return { type: "none" };

  const entry = index.ids.find((e) => e.id === newId);
  if (!entry) return { type: "none" };
  const newName = baseName(ev.newPath).replace(/\.md$/, "");
  if (ev.isFolder) {
    if (!entry.notePath) return { type: "none" };
    const newPartnerPath = `${parentOf(entry.notePath)}/${newName}.md`;
    if (newPartnerPath === entry.notePath) return { type: "none" };
    return { type: "rename-partner", id: newId, partnerPath: entry.notePath, newPartnerPath };
  }
  if (!entry.folderPath) return { type: "none" };
  const newPartnerPath = `${parentOf(entry.folderPath)}/${newName}`;
  if (newPartnerPath === entry.folderPath) return { type: "none" };
  return { type: "rename-partner", id: newId, partnerPath: entry.folderPath, newPartnerPath };
}
