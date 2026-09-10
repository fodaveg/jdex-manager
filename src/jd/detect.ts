/**
 * Pure detection of the standard management folders of a Johnny.Decimal system.
 * No Obsidian imports: it works on vault-relative folder paths so it runs in Node tests.
 *
 * Convention (johnnydecimal.com, "the standard zeros"): the area `00-09` manages the system,
 * its category `00` manages the whole thing, and inside it `00.00` is the JDex,
 * `00.02` holds maintenance and audits, `00.03` holds templates.
 */

import { extractJdPrefix } from "./parse";

export interface DetectedFolders {
  /** Folder whose name starts with `00.00`, or null. */
  jdex: string | null;
  /** Folder whose name starts with `00.02`, or null. */
  reports: string | null;
  /** Folder whose name starts with `00.03`, or null. */
  templates: string | null;
}

/** Path of `path` relative to `root`, or null when it is not inside. Empty root = everything. */
export function relativeTo(root: string, path: string): string | null {
  const r = root.replace(/^\/+|\/+$/g, "");
  if (r === "") return path;
  if (path === r) return "";
  if (path.startsWith(r + "/")) return path.slice(r.length + 1);
  return null;
}

/**
 * Finds `00.00`, `00.02` and `00.03` as `AREA/CATEGORY/ID` folders where the area is `00-09`
 * and the category is `00`, relative to `systemRoot`. First match wins for each.
 */
export function detectFolders(folderPaths: string[], systemRoot = ""): DetectedFolders {
  const out: DetectedFolders = { jdex: null, reports: null, templates: null };
  for (const path of folderPaths) {
    const rel = relativeTo(systemRoot, path);
    if (rel === null) continue;
    const parts = rel.split("/");
    if (parts.length !== 3) continue;
    const area = extractJdPrefix(parts[0]);
    const category = extractJdPrefix(parts[1]);
    const id = extractJdPrefix(parts[2]);
    if (!area || area.number.kind !== "area" || area.number.area !== 0) continue;
    if (!category || category.number.kind !== "category" || category.number.category !== "00") continue;
    if (!id || id.number.kind !== "id") continue;
    if (id.number.id === "00.00" && out.jdex === null) out.jdex = path;
    else if (id.number.id === "00.02" && out.reports === null) out.reports = path;
    else if (id.number.id === "00.03" && out.templates === null) out.templates = path;
  }
  return out;
}

/** Fills only the empty fields of `current` from `detected`; never overwrites a configured value. */
export function fillEmpty<T extends { jdexFolder: string; reportsFolder: string; templatesFolder: string }>(
  current: T,
  detected: DetectedFolders,
): { next: T; changed: boolean } {
  const next = { ...current };
  let changed = false;
  if (next.jdexFolder === "" && detected.jdex) {
    next.jdexFolder = detected.jdex;
    changed = true;
  }
  if (next.reportsFolder === "" && detected.reports) {
    next.reportsFolder = detected.reports;
    changed = true;
  }
  if (next.templatesFolder === "" && detected.templates) {
    next.templatesFolder = detected.templates;
    changed = true;
  }
  return { next, changed };
}
