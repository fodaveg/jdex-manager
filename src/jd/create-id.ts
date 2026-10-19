/**
 * Plan and apply "create a new ID" over a `LibraryPort` (id-based, no vault paths).
 * Same number, folder name, JDex note name, template and frontmatter as the Hebra plugin's
 * Create ID flow. Scope: one new content ID inside an existing category. No categories,
 * areas, `+` children or moves.
 *
 * Flow: `resolveSettings` (find the JDex and templates folders) -> `loadLibraryState`
 * (index + path/id maps) -> `planNewId` (a plan with preconditions and writes) ->
 * `applyPlan` (re-reads, re-checks, writes with ensure*).
 */

import { detectFolders, fillEmpty } from "./detect";
import { areaCode, buildIndex, knownIds, selectCreationSystem, type JdIndex } from "./index";
import type { LibraryPort, PortFolder } from "./library-port";
import { extractJdPrefix, jdexNoteName, nextFreeId, parseJdNumber } from "./parse";
import { patternFor } from "./patterns";
import { DEFAULT_SETTINGS, mergeSettings, type JdexManagerSettings } from "./settings";
import { BUILTIN_TEMPLATES, renderTemplate, templateNameCandidates, todayIso } from "./template";
import { requireTitle, validateNewId } from "./create-validate";

export type JdLibraryErrorCode =
  | "jdex_not_found"
  | "templates_not_found"
  | "category_not_found"
  | "category_folder_not_found"
  | "category_has_hidden"
  | "category_full"
  | "id_taken"
  | "invalid_pattern"
  | "invalid_title"
  | "plan_stale";

export type JdLibraryResult<T> = { ok: true; value: T } | { ok: false; code: JdLibraryErrorCode; message: string };

/** A folder the engine detected or was told about. */
export interface ResolvedFolder {
  id: string;
  /** Last path segment. */
  name: string;
  /** Full path from the top of the library, rebuilt from the `parentId` chain. */
  path: string;
}

export interface ResolveSettingsOptions {
  /** Overrides the detected `00.00` folder. */
  jdexFolderId?: string;
  /** Overrides the detected `00.03` folder. */
  templatesFolderId?: string;
  /**
   * The host's own configuration (the Hebra plugin's settings): when given, nothing is
   * detected. `jdexFolder` and `templatesFolder` are library paths looked up in the folder
   * tree; an empty or missing templates folder means the built-in templates, a missing JDex
   * folder is `jdex_not_found`. Explicit ids above still win.
   */
  settings?: Partial<JdexManagerSettings>;
}

export interface ResolvedSettings {
  /** `DEFAULT_SETTINGS` with the detected folders filled in. */
  settings: JdexManagerSettings;
  jdex: ResolvedFolder;
  /** Null when the library has no templates folder: built-in templates are used. */
  templates: ResolvedFolder | null;
}

/** The library as the engine sees it: the index plus the maps that let a plan speak in ids. */
export interface LibraryState {
  resolved: ResolvedSettings;
  index: JdIndex;
  folders: { id: string; parentId: string | null; name: string; path: string }[];
  /** Folder path -> id (first id wins on a repeated path). */
  folderIdByPath: Map<string, string>;
  /** Notes directly inside the JDex folder. */
  jdexNotes: { id: string; title: string; path: string }[];
  /** Notes directly inside the templates folder. */
  templateNotes: { id: string; title: string }[];
}

export interface NewIdRequest {
  /** Existing category number, `"21"`. */
  category: string;
  title: string;
  /** System of the category (`D01`); empty or absent = the default system. */
  systemId?: string;
  /** Also create the ID folder inside the category folder. Default true. */
  createFolder?: boolean;
  /** Also create the category's subfolder pattern inside the ID folder. Default false. */
  createPattern?: boolean;
  /** A number chosen by the user instead of the next free one; validated like the dialog does. */
  id?: string;
  /**
   * When the ID folder is wanted but the category has no folder: plan the note alone and set
   * `folderSkipped`, instead of failing with `category_folder_not_found`.
   */
  skipMissingCategoryFolder?: boolean;
}

/** What one expected output of a plan is: a folder or a JDex note, by parent id and exact name. */
export interface PlannedOutput {
  kind: "folder" | "note";
  parentId: string;
  /** Exact folder name or note title. */
  name: string;
}

export type PlanPrecondition =
  | { kind: "folder"; role: "jdex" | "category"; folderId: string; name: string }
  | { kind: "not_hidden"; category: string }
  /** The ID is free, or occupied only by outputs of this plan (`PlannedOutput`). */
  | { kind: "id_free"; id: string; system: string };

export type PlanWrite =
  | { kind: "ensure_note"; folderId: string; title: string; body: string }
  /** `parent` is a folder id, or the index of an earlier `ensure_folder` write. */
  | { kind: "ensure_folder"; parent: { folderId: string } | { write: number }; name: string };

export interface PlannedTemplate {
  /** `templates-folder`: a note of 00.03 read with `readNote`; `builtin`: `BUILTIN_TEMPLATES`. */
  source: "templates-folder" | "builtin";
  /** Name of the template note when `source` is `templates-folder`. */
  noteName?: string;
  noteId?: string;
}

export interface NewIdPlan {
  id: string;
  system: string;
  category: { number: string; label: string; folderId: string | null };
  /** The folders the plan resolved. */
  resolved: ResolvedSettings;
  /** JDex note name (= title of the note to create). */
  noteName: string;
  /** Name of the ID folder, or null when no folder is planned. */
  folderName: string | null;
  /** Set when the folder was wanted but skipped (`skipMissingCategoryFolder`). */
  folderSkipped?: "category_folder_not_found";
  template: PlannedTemplate;
  preconditions: PlanPrecondition[];
  outputs: PlannedOutput[];
  writes: PlanWrite[];
}

export interface CreatedItem {
  kind: "folder" | "note";
  id: string;
  name: string;
}

export interface ApplyOutcome {
  created: CreatedItem[];
  existing: CreatedItem[];
}

function fail<T>(code: JdLibraryErrorCode, message: string): JdLibraryResult<T> {
  return { ok: false, code, message };
}

/** Same filename stem rules as Hebra's `sanitizeNoteFileStem`, so the path the engine sees for
 *  a note is the one a Hebra host builds. UTF-8 sizes are counted by hand (no host globals). */
export function portNoteFileStem(title: string): string {
  // eslint-disable-next-line no-control-regex -- matches Hebra's filename sanitizer.
  let cleaned = title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "–").replace(/[ .]+$/gu, "").trim();
  if (!cleaned) cleaned = "Nota sin título";
  if (cleaned.startsWith(".")) cleaned = `_${cleaned}`;
  let stem = "";
  let bytes = 0;
  for (const point of cleaned) {
    const code = point.codePointAt(0)!;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > 218 || stem.length + point.length > 218) break;
    stem += point;
    bytes += size;
  }
  return stem;
}

/** Full path of every folder, rebuilt from the `parentId` chain (names in NFC, case kept). */
function folderPathsOf(folders: PortFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();
  const visiting = new Set<string>();
  const pathOf = (id: string): string => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (!folder || visiting.has(id)) return "";
    visiting.add(id);
    const parent = folder.parentId === null ? "" : pathOf(folder.parentId);
    visiting.delete(id);
    const name = folder.name.normalize("NFC");
    const path = parent ? `${parent}/${name}` : name;
    cache.set(id, path);
    return path;
  };
  for (const f of folders) pathOf(f.id);
  return cache;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Finds the JDex (`00.00`) and templates (`00.03`) folders from `listFolders`, with
 * `detectFolders` and `fillEmpty`. An explicit id overrides what was detected.
 * Without a JDex folder: `jdex_not_found`.
 */
export async function resolveSettings(port: LibraryPort, options: ResolveSettingsOptions = {}): Promise<JdLibraryResult<ResolvedSettings>> {
  const folders = await port.listFolders();
  const paths = folderPathsOf(folders);
  const idByPath = new Map<string, string>();
  for (const [id, path] of [...paths].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!idByPath.has(path)) idByPath.set(path, id);
  const own = options.settings ? mergeSettings(options.settings) : null;
  const detected = own ? { jdex: null, reports: null, templates: null } : detectFolders([...paths.values()]);
  const pick = (override: string | undefined, found: string | null): ResolvedFolder | null | undefined => {
    if (override !== undefined) {
      const path = paths.get(override);
      return path === undefined ? undefined : { id: override, name: lastSegment(path), path };
    }
    const id = found === null ? undefined : idByPath.get(found);
    return found === null || id === undefined ? null : { id, name: lastSegment(found), path: found };
  };
  const configured = (path: string | undefined): string | null => (own && path ? path.normalize("NFC") : null);
  const jdex = pick(options.jdexFolderId, detected.jdex ?? configured(own?.jdexFolder));
  if (!jdex) return fail("jdex_not_found", "No hay carpeta del JDex (00.00).");
  const templates = pick(options.templatesFolderId, detected.templates ?? configured(own?.templatesFolder));
  if (templates === undefined) return fail("templates_not_found", "La carpeta de plantillas indicada no existe.");
  const base = { ...(own ?? DEFAULT_SETTINGS), jdexFolder: options.jdexFolderId !== undefined || own ? jdex.path : "", templatesFolder: (options.templatesFolderId !== undefined || own) && templates ? templates.path : "" };
  const settings = fillEmpty(base, detected).next;
  return { ok: true, value: { settings, jdex, templates } };
}

/** Hex of a note id for the tie-break suffix; a non-canonical id gets a stable FNV-1a hash (as the Hebra plugin does). */
function noteIdHex(id: string): string {
  const compact = id.replace(/-/gu, "").toLowerCase();
  if (/^[0-9a-f]{32}$/u.test(compact)) return compact;
  let hash = 0x811c9dc5;
  for (const point of id) hash = Math.imul(hash ^ point.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/**
 * Two notes of one folder with the same title share a path and the path-based index would
 * see only one. The first id keeps the path; the others get Hebra's own tie-break
 * (`Title--1a2b3c4d.md`), which the engine ignores when comparing titles.
 */
function tieBreakPaths<T extends { id: string; path: string }>(notes: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const note of notes) groups.set(note.path, [...(groups.get(note.path) ?? []), note]);
  const out: T[] = [];
  for (const [base, group] of groups) {
    const ordered = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    ordered.forEach((note, position) => out.push(position === 0 ? note : { ...note, path: `${base.slice(0, -3)}--${noteIdHex(note.id).slice(0, 8)}.md` }));
  }
  return out;
}

/** Reads the library and builds the index (`buildIndex` works on relative paths) plus the maps that let a plan speak in ids. */
export async function loadLibraryState(port: LibraryPort, resolved: ResolvedSettings): Promise<LibraryState> {
  const portFolders = await port.listFolders();
  const paths = folderPathsOf(portFolders);
  const folders = portFolders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name.normalize("NFC"), path: paths.get(f.id) ?? "" }));
  const folderIdByPath = new Map<string, string>();
  for (const f of [...folders].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!folderIdByPath.has(f.path)) folderIdByPath.set(f.path, f.id);
  const jdexPath = paths.get(resolved.jdex.id) ?? resolved.jdex.path;
  const jdexNotes = tieBreakPaths((await port.listNotes(resolved.jdex.id)).map((n) => {
    const title = n.title.normalize("NFC");
    return { id: n.id, title, path: `${jdexPath}/${portNoteFileStem(title)}.md` };
  }));
  const templateNotes = resolved.templates ? (await port.listNotes(resolved.templates.id)).map((n) => ({ id: n.id, title: n.title.normalize("NFC") })) : [];
  const settings = { ...resolved.settings, jdexFolder: jdexPath };
  const index = buildIndex({ systemRoot: settings.systemRoot, folderPaths: folders.map((f) => f.path), jdexFolder: jdexPath, notePaths: jdexNotes.map((n) => n.path) });
  return { resolved: { ...resolved, settings, jdex: { ...resolved.jdex, path: jdexPath } }, index, folders, folderIdByPath, jdexNotes, templateNotes };
}

/**
 * Plans one new content ID in an existing category: the next free number (highest in use
 * plus one, skipping headers), the JDex note and, by default, the ID folder. Nothing is
 * written. A category with hidden content is refused without saying which number is taken.
 */
export async function planNewId(port: LibraryPort, state: LibraryState, request: NewIdRequest, now = new Date()): Promise<JdLibraryResult<NewIdPlan>> {
  const titleError = requireTitle(request.title);
  if (titleError) return fail("invalid_title", titleError);
  const system = request.systemId ?? "";
  const index = selectCreationSystem(state.index, system);
  const category = index.categories.find((c) => c.number === request.category);
  if (!category) return fail("category_not_found", `La categoría ${request.category} no existe.`);
  if (await port.hasHidden(category.number)) return fail("category_has_hidden", `La categoría ${category.number} no admite IDs nuevos desde aquí.`);
  let id: string | null;
  if (request.id !== undefined) {
    const error = validateNewId(index, category.number, request.id, system);
    if (error) return fail("id_taken", error);
    const parsed = parseJdNumber(request.id);
    id = parsed && parsed.kind === "id" ? parsed.id : null;
  } else id = nextFreeId(category.number, knownIds(index, system), system);
  if (id === null) return fail("category_full", `La categoría ${category.number} no tiene IDs libres.`);
  const taken = validateNewId(index, category.number, id, system);
  if (taken) return fail("id_taken", taken);

  const { settings, jdex, templates } = state.resolved;
  const noteName = jdexNoteName(id, request.title, system);
  const area = index.areas.find((a) => a.number === category.areaNumber);
  const areaName = areaCode(category.areaNumber);
  let template: PlannedTemplate = { source: "builtin" };
  let text = BUILTIN_TEMPLATES.id;
  if (templates) {
    for (const name of templateNameCandidates(settings.templateNames.id, { category: category.number, area: areaName })) {
      const ref = state.templateNotes.find((n) => n.title === name);
      if (!ref) continue;
      const { body: found } = await port.readNote(ref.id);
      if (found === null) continue; // protected note: next candidate, then the built-in one.
      text = found;
      template = { source: "templates-folder", noteName: name, noteId: ref.id };
      break;
    }
  }
  const body = renderTemplate(text, {
    id,
    title: request.title.trim(),
    area: areaName,
    areaTitle: area?.label ?? areaName,
    category: category.number,
    categoryTitle: category.label,
    date: todayIso(now),
  });

  const preconditions: PlanPrecondition[] = [
    { kind: "folder", role: "jdex", folderId: jdex.id, name: jdex.name },
    { kind: "not_hidden", category: category.number },
    { kind: "id_free", id, system },
  ];
  const outputs: PlannedOutput[] = [{ kind: "note", parentId: jdex.id, name: noteName }];
  const writes: PlanWrite[] = [{ kind: "ensure_note", folderId: jdex.id, title: noteName, body }];
  const categoryFolderId: string | null = category.path ? (state.folderIdByPath.get(category.path) ?? null) : null;
  let folderName: string | null = null;
  let folderSkipped: NewIdPlan["folderSkipped"];
  if (request.createFolder !== false && (categoryFolderId === null || !category.path) && request.skipMissingCategoryFolder) folderSkipped = "category_folder_not_found";
  else if (request.createFolder !== false) {
    if (categoryFolderId === null || !category.path) return fail("category_folder_not_found", `La categoría ${category.number} no tiene carpeta.`);
    folderName = noteName;
    preconditions.splice(1, 0, { kind: "folder", role: "category", folderId: categoryFolderId, name: lastSegment(category.path) });
    outputs.push({ kind: "folder", parentId: categoryFolderId, name: folderName });
    writes.push({ kind: "ensure_folder", parent: { folderId: categoryFolderId }, name: folderName });
    const idFolderWrite = writes.length - 1;
    for (const pattern of request.createPattern ? patternFor(settings, category.number) : []) {
      let parent: { folderId: string } | { write: number } = { write: idFolderWrite };
      for (const segment of pattern.split("/")) {
        if (segment === "" || segment === "." || segment === "..") return fail("invalid_pattern", `Patrón de subcarpetas no válido: ${pattern}.`);
        writes.push({ kind: "ensure_folder", parent, name: segment });
        parent = { write: writes.length - 1 };
      }
    }
  }
  return {
    ok: true,
    value: {
      id,
      system,
      category: { number: category.number, label: category.label, folderId: categoryFolderId },
      resolved: state.resolved,
      noteName,
      folderName,
      ...(folderSkipped ? { folderSkipped } : {}),
      template,
      preconditions,
      outputs,
      writes,
    },
  };
}

/** Why a precondition no longer holds, or null when it does. */
async function brokenPrecondition(port: LibraryPort, state: LibraryState, plan: NewIdPlan, pre: PlanPrecondition): Promise<string | null> {
  switch (pre.kind) {
    case "folder":
      return state.folders.some((f) => f.id === pre.folderId && f.name === pre.name.normalize("NFC")) ? null : `la carpeta «${pre.name}» ya no está`;
    case "not_hidden":
      return (await port.hasHidden(pre.category)) ? `la categoría ${pre.category} cambió` : null;
    case "id_free": {
      // Only outputs of this very plan may hold the number: exact name under the planned parent.
      const ownFolder = (parentId: string | null, name: string): boolean => plan.outputs.some((out) => out.kind === "folder" && out.parentId === parentId && out.name.normalize("NFC") === name);
      for (const folder of state.folders) {
        const prefix = extractJdPrefix(folder.name);
        if (!prefix || prefix.number.kind !== "id" || (prefix.number.system ?? "") !== pre.system || prefix.number.id !== pre.id) continue;
        if (!ownFolder(folder.parentId, folder.name)) return `el ID ${pre.id} lo ocupa ya otra cosa`;
      }
      for (const raw of state.index.rawIdNotes) {
        if ((raw.system ?? "") !== pre.system || raw.id.replace(/\+$/, "") !== pre.id) continue;
        const notes = state.jdexNotes.filter((n) => n.path === raw.path);
        const own = notes.length > 0 && notes.every((n) => plan.outputs.some((out) => out.kind === "note" && out.parentId === state.resolved.jdex.id && out.name.normalize("NFC") === n.title));
        if (!own) return `el ID ${pre.id} lo ocupa ya otra cosa`;
      }
      return null;
    }
  }
}

/**
 * Re-reads the library, re-checks the plan's preconditions and, if all hold, runs its
 * writes in order with the port's ensure* calls. A retry after a failure half way completes
 * what is missing without duplicating: the "ID free" precondition accepts an ID occupied
 * only by this plan's own expected outputs (same name under the same parent). Anything
 * else changed returns `plan_stale` and nothing is written.
 */
export async function applyPlan(port: LibraryPort, plan: NewIdPlan): Promise<JdLibraryResult<ApplyOutcome>> {
  const state = await loadLibraryState(port, plan.resolved);
  for (const pre of plan.preconditions) {
    const broken = await brokenPrecondition(port, state, plan, pre);
    if (broken) return fail("plan_stale", `El plan ya no vale: ${broken}. No se ha cambiado nada.`);
  }
  const outcome: ApplyOutcome = { created: [], existing: [] };
  const folderIds: string[] = [];
  const resolveParent = (parent: { folderId: string } | { write: number }): string => ("folderId" in parent ? parent.folderId : folderIds[parent.write]);
  for (const [position, write] of plan.writes.entries()) {
    if (write.kind === "ensure_note") {
      const result = await port.ensureNote(write.folderId, write.title, write.body);
      (result.created ? outcome.created : outcome.existing).push({ kind: "note", id: result.id, name: write.title });
    } else {
      const result = await port.ensureFolder(resolveParent(write.parent), write.name);
      folderIds[position] = result.id;
      (result.created ? outcome.created : outcome.existing).push({ kind: "folder", id: result.id, name: write.name });
    }
  }
  return { ok: true, value: outcome };
}

