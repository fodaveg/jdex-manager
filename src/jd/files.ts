/**
 * Where a file lives in the system and how it should be named. Pure.
 * Spec: inbox-archive, saving-files, naming-files (johnnydecimal.com).
 */

import { relativeTo } from "./detect";
import type { IdEntry, JdIndex } from "./index";
import { extractJdPrefix, isReserved, parseJdNumber } from "./parse";

export type DateFormat = "YYYY-MM-DD" | "YYYY-MM";

/** Category number (`21`) of a path inside `systemRoot/AREA/CATEGORY/...`, or null. */
export function categoryOfPath(systemRoot: string, path: string): string | null {
  const rel = relativeTo(systemRoot, path);
  if (rel === null) return null;
  const parts = rel.split("/");
  if (parts.length < 3) return null;
  const area = extractJdPrefix(parts[0]);
  const cat = extractJdPrefix(parts[1]);
  if (!area || area.number.kind !== "area" || !cat || cat.number.kind !== "category") return null;
  const value = Number(cat.number.category);
  if (value < area.number.area || value > area.number.area + 9) return null;
  return cat.number.category;
}

/** The ID whose folder contains `path` (the file itself excluded), or null. */
export function idFolderOfPath(index: JdIndex, path: string): IdEntry | null {
  for (const entry of index.ids) {
    if (entry.folderPath && path.startsWith(entry.folderPath + "/")) return entry;
  }
  return null;
}

/** Every inbox folder (`AC.01`) that exists in the system, 00.01 included. */
export function inboxFolders(index: JdIndex): IdEntry[] {
  return index.ids.filter((e) => e.folderPath && e.id.endsWith(".01"));
}

/** The `.01` or `.09` entry of a category. */
export function zeroOf(index: JdIndex, category: string, zero: "01" | "09"): IdEntry | undefined {
  return index.ids.find((e) => e.id === `${category}.${zero}`);
}

const DATE_PREFIX = /^\d{4}-\d{2}(-\d{2})?(?=[\s_.-]|$)/;

export function isDated(name: string): boolean {
  return DATE_PREFIX.test(name);
}

export function formatDate(date: Date, format: DateFormat): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return format === "YYYY-MM" ? `${y}-${m}` : `${y}-${m}-${d}`;
}

/** `name` with a date prefix unless it already has one. */
export function datedName(name: string, date: Date, format: DateFormat): string {
  return isDated(name) ? name : `${formatDate(date, format)} ${name}`;
}

/**
 * Files that must never be dated: JDex notes, templates, reports and anything inside a management ID
 * (`.00` to `.09`), plus files that are not inside an ID folder at all.
 */
export function isDatable(
  index: JdIndex,
  settings: { jdexFolder: string; templatesFolder: string; reportsFolder: string },
  path: string,
): boolean {
  for (const folder of [settings.jdexFolder, settings.templatesFolder, settings.reportsFolder]) {
    if (folder !== "" && relativeTo(folder, path) !== null) return false;
  }
  const entry = idFolderOfPath(index, path);
  if (!entry) return false;
  const n = parseJdNumber(entry.id);
  if (!n || n.kind !== "id" || isReserved(n)) return false;
  return true;
}

/** Direct children of a folder among `filePaths` (no sub-folders). */
export function directFiles(folder: string, filePaths: string[]): string[] {
  const prefix = folder + "/";
  return filePaths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
}
