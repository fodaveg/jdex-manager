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

import type { JdIndex } from "./index";
import type { LibraryPort } from "./library-port";
import type { JdexManagerSettings } from "./settings";

export type JdLibraryErrorCode =
  | "jdex_not_found"
  | "templates_not_found"
  | "category_not_found"
  | "category_folder_not_found"
  | "category_has_hidden"
  | "category_full"
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

export function resolveSettings(_port: LibraryPort, _options: ResolveSettingsOptions = {}): Promise<JdLibraryResult<ResolvedSettings>> {
  throw new Error("not implemented");
}

export function loadLibraryState(_port: LibraryPort, _resolved: ResolvedSettings): Promise<LibraryState> {
  throw new Error("not implemented");
}

export function planNewId(_port: LibraryPort, _state: LibraryState, _request: NewIdRequest, _now?: Date): Promise<JdLibraryResult<NewIdPlan>> {
  throw new Error("not implemented");
}

export function applyPlan(_port: LibraryPort, _plan: NewIdPlan): Promise<JdLibraryResult<ApplyOutcome>> {
  throw new Error("not implemented");
}
