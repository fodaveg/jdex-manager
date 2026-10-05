/**
 * Pure index of a Johnny.Decimal system built from vault-relative paths.
 * No Obsidian imports: the vault layer feeds it folder and note paths, tests feed it literals.
 *
 * Two sources, merged by number:
 * - System folders under `systemRoot`: `AREA/CATEGORY/ID`, with `+ Title` children inside IDs, each level validated against its parent
 *   (a `21` folder only counts inside a `20-29` area; a `21.22` folder only inside `21`).
 * - JDex notes directly inside `jdexFolder`: `AC.ID Title.md` is an ID, `AC Title.md` a category,
 *   `A0-A9 Title.md` an area.
 */

import { relativeTo } from "./detect";
import { extractJdPrefix, nextFreeId, parseJdNumber } from "./parse";
import { titleForCompare } from "./title";

export interface AreaEntry {
  /** Explicit prefix; absent means the default system. */
  system?: string;
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
  /** Explicit prefix; absent means the default system. */
  system?: string;
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
  /** Explicit prefix; absent means the default system. */
  system?: string;
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
  /** Explicit prefix; absent means the default system. */
  system?: string;
  path: string;
  label: string;
  /** `21.22`, `35` … */
  number: string;
  /** Number of the folder it sits in. */
  parent: string;
  /** Wrong structural depth, rather than a number outside its parent range. */
  wrongDepth?: boolean;
}

/** Every validated ID folder or JDex ID note, before merging by number. Lets the audit find duplicates. */
export interface RawIdEntry {
  /** Explicit prefix; absent means the default system. */
  system?: string;
  id: string;
  path: string;
  label: string;
}

export interface MalformedEntry {
  system?: string;
  path: string;
  message: string;
}

export interface JdIndex {
  /** Set by selectSystem; omitted on an index containing every system. */
  system?: string;
  malformed?: MalformedEntry[];
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
function mapKey(id: string, extension: "+" | undefined, title: string, system?: string): string {
  return systemKey(extension ? `${id}+ ${titleForCompare(title)}` : id, system);
}

/** Stable identity without changing the local number exposed to existing consumers. */
export function systemKey(number: string | number, system = ""): string {
  return system ? `${system}.${number}` : String(number);
}

/** Missing prefixes belong to the default system, never to every system. */
export function sameSystem(left: { system?: string }, right: { system?: string }): boolean {
  return (left.system ?? "") === (right.system ?? "");
}

/** A view for number-only consumers, keeping the chosen system explicit. */
export function selectSystem(index: JdIndex, system = ""): JdIndex {
  const belongs = (entry: { system?: string }): boolean => (entry.system ?? "") === system;
  return { ...index, system, malformed: (index.malformed ?? []).filter(belongs), areas: index.areas.filter(belongs), categories: index.categories.filter(belongs),
    ids: index.ids.filter(belongs), misplaced: index.misplaced.filter(belongs),
    rawIdFolders: index.rawIdFolders.filter(belongs), rawIdNotes: index.rawIdNotes.filter(belongs) };
}

/** Creation in a prefixed system can use unprefixed physical scaffolding when
 * that system has no own area/category. JDex note titles are never borrowed. */
export function selectCreationSystem(index: JdIndex, system = ""): JdIndex {
  const selected = selectSystem(index, system);
  if (!system) return selected;
  for (const area of index.areas) {
    if (area.system || !area.path || selected.areas.some((a) => a.number === area.number)) continue;
    selected.areas.push({ ...area, system, notePath: undefined });
  }
  for (const category of index.categories) {
    if (category.system || !category.path || selected.categories.some((c) => c.number === category.number)) continue;
    selected.categories.push({ ...category, system, notePath: undefined });
  }
  return selected;
}

/** Recognizable JD notation that must be reported instead of silently ignored. */
function malformedNumber(path: string, name: string): MalformedEntry | null {
  const system = /^([A-Z]\d{2})\./.exec(name)?.[1];
  const identity = system ? { system } : {};
  if (/^(?:[A-Z]\d{2}\.)?\d{2}\.\d(?:\+)?(?:[\s_-]|$)/.test(name)) {
    return { path, ...identity, message: `${name}: el ID necesita dos dígitos después del punto.` };
  }
  const prefix = extractJdPrefix(name);
  if (prefix?.number.kind === "id" && prefix.title.startsWith("■") && !prefix.number.id.endsWith("0")) {
    return { path, ...identity, message: `${name}: ■ en un ID que no acaba en 0.` };
  }
  return null;
}

export function buildIndex(input: IndexInput): JdIndex {
  const areas = new Map<string, AreaEntry>();
  const categories = new Map<string, CategoryEntry>();
  const ids = new Map<string, IdEntry>();
  const misplaced: MisplacedEntry[] = [];
  const malformed: MalformedEntry[] = [];
  const rawIdFolders: RawIdEntry[] = [];
  const rawIdNotes: RawIdEntry[] = [];

  // System folders, shallowest first so parents are known before children.
  const folders = input.folderPaths
    .map((path) => ({ path, rel: relativeTo(input.systemRoot, path) }))
    .filter((f): f is { path: string; rel: string } => f.rel !== null && f.rel !== "")
    .map((f) => ({ ...f, parts: f.rel.split("/") }))
    .filter((f) => f.parts.length <= 4)
    .sort((a, b) => a.parts.length - b.parts.length);

  for (const f of folders) {
    const name = f.parts[f.parts.length - 1];
    const malformedEntry = malformedNumber(f.path, name);
    if (malformedEntry) malformed.push(malformedEntry);
    const numbered = extractJdPrefix(name);
    const parentPath = f.path.slice(0, f.path.lastIndexOf("/"));
    const parentIdFolder = f.parts.length === 4
      ? rawIdFolders.find((entry) => entry.path === parentPath && !entry.id.endsWith("+"))
      : undefined;
    // Local NN names below a validated ID organize its content; they are not
    // system categories. Explicit system prefixes, IDs and areas remain structural.
    if (parentIdFolder && !malformed.some((entry) => entry.path === parentPath) &&
      numbered?.number.kind === "category" && !numbered.number.system) continue;
    if (numbered && ((numbered.number.kind === "area" && f.parts.length !== 1) ||
      (numbered.number.kind === "category" && f.parts.length !== 2) ||
      (numbered.number.kind === "id" && f.parts.length !== 3))) {
      const n = numbered.number;
      misplaced.push({ path: f.path, label: name, number: n.kind === "area" ? areaCode(n.area) : n.kind === "category" ? n.category : idKey(n.id, n.extension),
        parent: f.parts.slice(0, -1).join("/") || "raíz del sistema", wrongDepth: true, ...(n.system ? { system: n.system } : {}) });
      continue;
    }
    // Only `+ Title` folders directly inside a validated ID are child IDs.
    if (f.parts.length === 4) {
      if (!name.startsWith("+ ") || name.slice(2).trim() === "") continue;
      const parent = parentIdFolder;
      if (!parent) continue;
      const title = name.slice(2);
      const key = `${parent.id}+`;
      const mk = mapKey(parent.id, "+", title, parent.system);
      const label = `${key} ${title}`;
      rawIdFolders.push({ id: key, path: f.path, label, ...(parent.system ? { system: parent.system } : {}) });
      ids.set(mk, { id: key, category: parent.id.slice(0, 2), title, label, folderPath: f.path, ...(parent.system ? { system: parent.system } : {}) });
      continue;
    }
    const parsed = extractJdPrefix(name);
    if (!parsed) continue;
    const n = parsed.number;
    if (f.parts.length === 1) {
      if (n.kind !== "area") continue;
      const entry = areas.get(systemKey(n.area, n.system)) ?? { number: n.area, code: areaCode(n.area), title: parsed.title, label: name, ...(n.system ? { system: n.system } : {}) };
      entry.path = f.path;
      entry.title = parsed.title;
      entry.label = name;
      areas.set(systemKey(n.area, n.system), entry);
    } else if (f.parts.length === 2) {
      if (n.kind !== "category") continue;
      const parent = extractJdPrefix(f.parts[0]);
      if (!parent || parent.number.kind !== "area") continue;
      const value = Number(n.category);
      if ((parent.number.system !== undefined && !sameSystem(n, parent.number)) || value < parent.number.area || value > parent.number.area + 9) {
        misplaced.push({ path: f.path, label: name, number: n.category, parent: systemKey(areaCode(parent.number.area), parent.number.system), ...(n.system ? { system: n.system } : {}) });
        continue;
      }
      const entry = categories.get(systemKey(n.category, n.system)) ?? {
        number: n.category,
        areaNumber: parent.number.area,
        title: parsed.title,
        label: name,
        ...(n.system ? { system: n.system } : {}),
      };
      entry.path = f.path;
      entry.title = parsed.title;
      entry.label = name;
      categories.set(systemKey(n.category, n.system), entry);
    } else {
      if (n.kind !== "id") continue;
      const parent = extractJdPrefix(f.parts[1]);
      if (!parent || parent.number.kind !== "category") continue;
      const grand = extractJdPrefix(f.parts[0]);
      if (!grand || grand.number.kind !== "area") continue;
      if ((parent.number.system !== undefined && !sameSystem(n, parent.number)) || (grand.number.system !== undefined && !sameSystem(n, grand.number)) || parent.number.category !== n.category || Number(parent.number.category) < grand.number.area || Number(parent.number.category) > grand.number.area + 9) {
        misplaced.push({ path: f.path, label: name, number: idKey(n.id, n.extension), parent: systemKey(parent.number.category, parent.number.system), ...(n.system ? { system: n.system } : {}) });
        continue;
      }
      const key = idKey(n.id, n.extension);
      const mk = mapKey(n.id, n.extension, parsed.title, n.system);
      rawIdFolders.push({ id: key, path: f.path, label: name, ...(n.system ? { system: n.system } : {}) });
      const entry = ids.get(mk) ?? { id: key, category: n.category, title: parsed.title, label: name, ...(n.system ? { system: n.system } : {}) };
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
      const malformedEntry = malformedNumber(path, name);
      if (malformedEntry) malformed.push(malformedEntry);
      const parsed = extractJdPrefix(name);
      if (!parsed) continue;
      const n = parsed.number;
      if (n.kind === "id") {
        const key = idKey(n.id, n.extension);
        const mk = mapKey(n.id, n.extension, parsed.title, n.system);
        rawIdNotes.push({ id: key, path, label: name, ...(n.system ? { system: n.system } : {}) });
        const entry = ids.get(mk) ?? { id: key, category: n.category, title: parsed.title, label: name, ...(n.system ? { system: n.system } : {}) };
        entry.notePath = path;
        entry.title = parsed.title;
        entry.label = name;
        ids.set(mk, entry);
      } else if (n.kind === "category") {
        const entry = categories.get(systemKey(n.category, n.system)) ?? {
          number: n.category,
          areaNumber: Math.floor(Number(n.category) / 10) * 10,
          title: parsed.title,
          label: name,
          ...(n.system ? { system: n.system } : {}),
        };
        entry.notePath = path;
        if (!entry.path) {
          entry.title = parsed.title;
          entry.label = name;
        }
        categories.set(systemKey(n.category, n.system), entry);
      } else {
        const entry = areas.get(systemKey(n.area, n.system)) ?? { number: n.area, code: areaCode(n.area), title: parsed.title, label: name, ...(n.system ? { system: n.system } : {}) };
        entry.notePath = path;
        if (!entry.path) {
          entry.title = parsed.title;
          entry.label = name;
        }
        areas.set(systemKey(n.area, n.system), entry);
      }
    }
  }

  return {
    areas: [...areas.values()].sort((a, b) => a.number - b.number),
    categories: [...categories.values()].sort((a, b) => a.number.localeCompare(b.number)),
    ids: [...ids.values()].sort((a, b) => a.id.localeCompare(b.id) || a.title.localeCompare(b.title)),
    misplaced,
    malformed,
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
export function knownIds(index: JdIndex, system = index.system ?? ""): string[] {
  return index.ids.filter((e) => (e.system ?? "") === system).map((e) => e.id);
}

/** The entry that already uses `id` (without `+`), if any. */
export function findId(index: JdIndex, id: string, system = index.system ?? ""): IdEntry | undefined {
  const n = parseJdNumber(id);
  return index.ids.find((e) => e.id === (n?.kind === "id" ? idKey(n.id, n.extension) : id) && (e.system ?? "") === (n?.system ?? system));
}

/** The `+` children of an ID. */
export function childrenPlus(index: JdIndex, id: string, system = index.system ?? ""): IdEntry[] {
  const n = parseJdNumber(id);
  return index.ids.filter((e) => e.id === `${n?.kind === "id" ? n.id : id}+` && (e.system ?? "") === (n?.system ?? system));
}

/** Content IDs (.11 to .99, X0 headers excluded) in use in a category, out of the 81 available. */
export function categoryUsage(index: JdIndex, category: string, system = index.system ?? ""): { used: number; total: number; next: string | null } {
  const used = new Set<string>();
  for (const e of index.ids) {
    if ((e.system ?? "") !== system || e.category !== category || e.id.endsWith("+")) continue;
    const last = Number(e.id.split(".")[1]);
    if (last >= 11 && last % 10 !== 0) used.add(e.id);
  }
  // Same rule as Create ID: the highest in use plus one, gaps are never refilled.
  return { used: used.size, total: 81, next: nextFreeId(category, knownIds(index, system)) };
}
