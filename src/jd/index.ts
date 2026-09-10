/**
 * Pure index of a Johnny.Decimal system built from vault-relative paths.
 * No Obsidian imports: the vault layer feeds it folder and note paths, tests feed it literals.
 *
 * Two sources, merged by number:
 * - System folders under `systemRoot`: `AREA/CATEGORY/ID`, each level validated against its parent
 *   (a `21` folder only counts inside a `20-29` area; a `21.22` folder only inside `21`).
 * - JDex notes directly inside `jdexFolder`: `AC.ID Title.md` is an ID, `AC Title.md` a category,
 *   `A0-A9 Title.md` an area.
 */

import { relativeTo } from "./detect";
import { extractJdPrefix } from "./parse";

export interface AreaEntry {
  /** First category of the area: 20 for `20-29`. */
  number: number;
  /** `20-29`. */
  code: string;
  /** Text after the prefix. */
  title: string;
  /** Full folder or note name with the prefix, `20-29 Trabajo y productos`. */
  label: string;
  /** Folder path in the system, when the folder exists. */
  path?: string;
  notePath?: string;
}

export interface CategoryEntry {
  /** `21`. */
  number: string;
  areaNumber: number;
  title: string;
  /** `21 Productos de software propios`. */
  label: string;
  path?: string;
  notePath?: string;
}

export interface IdEntry {
  /** `21.22`, or `21.22+` for an extension. */
  id: string;
  category: string;
  title: string;
  label: string;
  notePath?: string;
  folderPath?: string;
}

/** A folder that carries a JD number but sits under the wrong parent (`12.31` inside `11`, `35` inside `20-29`). */
export interface MisplacedEntry {
  path: string;
  label: string;
  /** `21.22`, `35` … */
  number: string;
  /** Number of the folder it sits in. */
  parent: string;
}

/** Every validated ID folder or JDex ID note, before merging by number. Lets the audit find duplicates. */
export interface RawIdEntry {
  id: string;
  path: string;
  label: string;
}

export interface JdIndex {
  areas: AreaEntry[];
  categories: CategoryEntry[];
  ids: IdEntry[];
  misplaced: MisplacedEntry[];
  rawIdFolders: RawIdEntry[];
  rawIdNotes: RawIdEntry[];
}

export interface IndexInput {
  /** Vault path of the system root; empty = vault root. */
  systemRoot: string;
  /** Every folder path in the vault (or at least every one under the system root). */
  folderPaths: string[];
  /** Vault path of the JDex folder; empty = no JDex notes are read. */
  jdexFolder: string;
  /** Every `.md` note path in the vault (or at least every one inside the JDex folder). */
  notePaths: string[];
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function idKey(id: string, extension?: "+"): string {
  return extension ? `${id}+` : id;
}

/** Map key: `+` children of one ID are different entries, told apart by title. */
function mapKey(id: string, extension: "+" | undefined, title: string): string {
  return extension ? `${id}+ ${title}` : id;
}

export function buildIndex(input: IndexInput): JdIndex {
  const areas = new Map<number, AreaEntry>();
  const categories = new Map<string, CategoryEntry>();
  const ids = new Map<string, IdEntry>();
  const misplaced: MisplacedEntry[] = [];
  const rawIdFolders: RawIdEntry[] = [];
  const rawIdNotes: RawIdEntry[] = [];

  // System folders, shallowest first so parents are known before children.
  const folders = input.folderPaths
    .map((path) => ({ path, rel: relativeTo(input.systemRoot, path) }))
    .filter((f): f is { path: string; rel: string } => f.rel !== null && f.rel !== "")
    .map((f) => ({ ...f, parts: f.rel.split("/") }))
    .filter((f) => f.parts.length <= 3)
    .sort((a, b) => a.parts.length - b.parts.length);

  for (const f of folders) {
    const name = f.parts[f.parts.length - 1];
    const parsed = extractJdPrefix(name);
    if (!parsed) continue;
    const n = parsed.number;
    if (f.parts.length === 1) {
      if (n.kind !== "area") continue;
      const entry = areas.get(n.area) ?? { number: n.area, code: areaCode(n.area), title: parsed.title, label: name };
      entry.path = f.path;
      entry.title = parsed.title;
      entry.label = name;
      areas.set(n.area, entry);
    } else if (f.parts.length === 2) {
      if (n.kind !== "category") continue;
      const parent = extractJdPrefix(f.parts[0]);
      if (!parent || parent.number.kind !== "area") continue;
      const value = Number(n.category);
      if (value < parent.number.area || value > parent.number.area + 9) {
        misplaced.push({ path: f.path, label: name, number: n.category, parent: areaCode(parent.number.area) });
        continue;
      }
      const entry = categories.get(n.category) ?? {
        number: n.category,
        areaNumber: parent.number.area,
        title: parsed.title,
        label: name,
      };
      entry.path = f.path;
      entry.title = parsed.title;
      entry.label = name;
      categories.set(n.category, entry);
    } else {
      if (n.kind !== "id") continue;
      const parent = extractJdPrefix(f.parts[1]);
      if (!parent || parent.number.kind !== "category") continue;
      const grand = extractJdPrefix(f.parts[0]);
      if (!grand || grand.number.kind !== "area") continue;
      if (parent.number.category !== n.category) {
        misplaced.push({ path: f.path, label: name, number: idKey(n.id, n.extension), parent: parent.number.category });
        continue;
      }
      const key = idKey(n.id, n.extension);
      const mk = mapKey(n.id, n.extension, parsed.title);
      rawIdFolders.push({ id: key, path: f.path, label: name });
      const entry = ids.get(mk) ?? { id: key, category: n.category, title: parsed.title, label: name };
      entry.folderPath = f.path;
      if (!entry.notePath) {
        entry.title = parsed.title;
        entry.label = name;
      }
      ids.set(mk, entry);
    }
  }

  // JDex notes: the note names the ID, so its title wins over the folder's.
  if (input.jdexFolder !== "") {
    for (const path of input.notePaths) {
      const rel = relativeTo(input.jdexFolder, path);
      if (rel === null || rel === "" || rel.includes("/") || !rel.endsWith(".md")) continue;
      const name = lastSegment(path).slice(0, -3);
      const parsed = extractJdPrefix(name);
      if (!parsed) continue;
      const n = parsed.number;
      if (n.kind === "id") {
        const key = idKey(n.id, n.extension);
        const mk = mapKey(n.id, n.extension, parsed.title);
        rawIdNotes.push({ id: key, path, label: name });
        const entry = ids.get(mk) ?? { id: key, category: n.category, title: parsed.title, label: name };
        entry.notePath = path;
        entry.title = parsed.title;
        entry.label = name;
        ids.set(mk, entry);
      } else if (n.kind === "category") {
        const entry = categories.get(n.category) ?? {
          number: n.category,
          areaNumber: Math.floor(Number(n.category) / 10) * 10,
          title: parsed.title,
          label: name,
        };
        entry.notePath = path;
        if (!entry.path) {
          entry.title = parsed.title;
          entry.label = name;
        }
        categories.set(n.category, entry);
      } else {
        const entry = areas.get(n.area) ?? { number: n.area, code: areaCode(n.area), title: parsed.title, label: name };
        entry.notePath = path;
        if (!entry.path) {
          entry.title = parsed.title;
          entry.label = name;
        }
        areas.set(n.area, entry);
      }
    }
  }

  return {
    areas: [...areas.values()].sort((a, b) => a.number - b.number),
    categories: [...categories.values()].sort((a, b) => a.number.localeCompare(b.number)),
    ids: [...ids.values()].sort((a, b) => a.id.localeCompare(b.id) || a.title.localeCompare(b.title)),
    misplaced,
    rawIdFolders,
    rawIdNotes,
  };
}

/** `20` → `20-29`. */
export function areaCode(area: number): string {
  return `${String(area).padStart(2, "0")}-${String(area + 9).padStart(2, "0")}`;
}

/** The area a category belongs to: `21` → 20. */
export function areaOfCategory(category: string): number {
  return Math.floor(Number(category) / 10) * 10;
}

/** Every ID (with `+` where present) known to the index. Input for `nextFreeId`. */
export function knownIds(index: JdIndex): string[] {
  return index.ids.map((e) => e.id);
}

/** The entry that already uses `id` (without `+`), if any. */
export function findId(index: JdIndex, id: string): IdEntry | undefined {
  return index.ids.find((e) => e.id === id);
}

/** The `+` children of an ID. */
export function childrenPlus(index: JdIndex, id: string): IdEntry[] {
  return index.ids.filter((e) => e.id === `${id}+`);
}
