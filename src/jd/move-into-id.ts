/**
 * Plan, apply and undo "move into an ID" over a `LibraryMovePort` (id-based, no vault paths):
 * the equivalent of `jd move <path> <id>[/<subfolder>] [--as <name>]` for a library addressed by
 * ids. A note, a loose file or a whole folder is filed inside the folder of an ID (or inside one
 * subfolder of it). The ID folder and the subfolder are created when missing.
 *
 * Flow: `planMoveIntoId` (a flat JSON plan with preconditions, folder writes and moves) ->
 * `applyMovePlan` (re-reads, re-checks, ensures the folders, moves) -> optionally
 * `planUndoMove` / `applyUndoMovePlan`. Unlike `jd move` and the Obsidian plugin, the name is
 * never dated.
 */

import { idFolderName, loadLibraryState, portNoteFileStem, type ApplyOutcome, type JdLibraryErrorCode, type JdLibraryResult, type LibraryState, type PlanWrite, type ResolvedSettings } from "./create-id";
import { requireTitle } from "./create-validate";
import { findId, selectCreationSystem } from "./index";
import type { LibraryPort } from "./library-port";
import { parseJdNumber } from "./parse";

/** What the host adds to `LibraryPort` to move things. `{ ok: false }` = no longer as expected. */
export interface LibraryMovePort extends LibraryPort {
  /** Loose files directly inside a folder (no notes, no subfolders). */
  listFiles(folderId: string): Promise<{ id: string; name: string }[]>;
  /** Whether the folder (or anything below it) holds something the caller may not see. */
  hiddenInside(folderId: string): Promise<boolean>;
  /** Moves (and, with `to.title`, renames) a note, if it still is in `expected`. */
  moveNote(id: string, expected: { folderId: string; title: string }, to: { folderId: string; title?: string }): Promise<{ ok: boolean }>;
  /** Moves (and, with `to.name`, renames) a loose file, if it still is in `expected`. */
  moveFile(id: string, expected: { folderId: string; name: string }, to: { folderId: string; name?: string }): Promise<{ ok: boolean }>;
  /** Moves (and, with `to.name`, renames) a folder, if it still is in `expected`. */
  moveFolder(id: string, expected: { parentId: string; name: string }, to: { parentId: string; name?: string }): Promise<{ ok: boolean }>;
}

export type MoveKind = "note" | "file" | "folder";

/** What to move. For a note or file, `folderId` (where it is now) saves a scan of the whole library. */
export type MoveSource = { kind: "note" | "file"; id: string; folderId?: string } | { kind: "folder"; id: string };

export interface MoveRequest {
  source: MoveSource;
  /** Destination ID, `"21.34"`. */
  toId: string;
  /** One level below the ID folder (`"Extractos"`); created when missing. */
  subfolder?: string;
  /** New name (title, for a note). */
  as?: string;
  /** System of the destination ID (`D01`); empty or absent = the default system. */
  systemId?: string;
}

/** A folder id, or the index of an earlier `ensure_folder` write of the same plan. */
export type MoveParent = string | { write: number };

export interface PlannedMove {
  kind: MoveKind;
  id: string;
  /** Where it is (title for a note, name for a file or folder). */
  from: { parentId: MoveParent; name: string };
  /** Where it goes; the name already holds `as` when given. */
  to: { parentId: MoveParent; name: string };
}

export type MovePrecondition =
  | { kind: "folder"; role: "jdex" | "category" | "id" | "subfolder"; folderId: string; name: string }
  | { kind: "not_hidden"; category: string }
  /** The ID is still in the JDex (it has a note). */
  | { kind: "id_in_jdex"; id: string; system: string }
  /** The folder to move still holds nothing hidden. */
  | { kind: "no_hidden_inside"; folderId: string };

export interface MovePlan {
  kind: "move_into_id";
  /** Destination ID. */
  id: string;
  system: string;
  resolved: ResolvedSettings;
  /** Folder name of the ID, and the subfolder asked for, if any. */
  destination: { folderName: string; subfolder: string | null };
  preconditions: MovePrecondition[];
  /** Only `ensure_folder`: the ID folder and the subfolder, when they do not exist yet. */
  writes: PlanWrite[];
  moves: PlannedMove[];
}

export interface MoveOutcome extends ApplyOutcome {
  moved: PlannedMove[];
  /** Moves a previous (interrupted) apply had already done. */
  alreadyDone: PlannedMove[];
}

export type MoveSkipReason = "not_where_left" | "destination_taken" | "refused";

/** The inverse of a `MovePlan`: each piece back to its `from`, newest first. Creates nothing. */
export interface UndoMovePlan {
  kind: "undo_move";
  resolved: ResolvedSettings;
  /** The forward plan's `ensure_folder` writes, used only to LOOK UP the folders it created. */
  lookups: PlanWrite[];
  /** `from` = where the apply left the piece; `to` = where it was. */
  moves: PlannedMove[];
}

export interface UndoMoveOutcome {
  restored: PlannedMove[];
  /** Pieces already back at their old place with their old name. */
  alreadyRestored: PlannedMove[];
  skipped: { move: PlannedMove; reason: MoveSkipReason }[];
}

function fail<T>(code: JdLibraryErrorCode, message: string): JdLibraryResult<T> {
  return { ok: false, code, message };
}

/** Same comparison as `ensureFolder`: NFC, trimmed, case-insensitive. */
function nameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/** Notes collide by the file name they would get, so two titles that sanitize alike count as one. */
function collisionKey(kind: MoveKind, name: string): string {
  return nameKey(kind === "note" ? portNoteFileStem(name) : name);
}

/** The folder and all its ancestors, by id. */
function chainOf(folders: LibraryState["folders"], id: string | null): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain = new Set<string>();
  let current = id;
  while (current !== null && !chain.has(current)) {
    chain.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return chain;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether `id` is in `parentId` under exactly `name` (NFC). */
async function holds(port: LibraryMovePort, state: LibraryState, kind: MoveKind, parentId: string, name: string, id: string): Promise<boolean> {
  const wanted = name.normalize("NFC");
  if (kind === "folder") return state.folders.some((f) => f.id === id && f.parentId === parentId && f.name === wanted);
  if (kind === "note") return (await port.listNotes(parentId)).some((n) => n.id === id && n.title.normalize("NFC") === wanted);
  return (await port.listFiles(parentId)).some((f) => f.id === id && f.name.normalize("NFC") === wanted);
}

/** Whether something other than `selfId` already uses `name` in the folder (the kind decides what is compared). */
async function nameTaken(port: LibraryMovePort, state: LibraryState, kind: MoveKind, parentId: string, name: string, selfId: string): Promise<boolean> {
  const key = collisionKey(kind, name);
  if (kind === "folder") return state.folders.some((f) => f.parentId === parentId && f.id !== selfId && nameKey(f.name) === key);
  if (kind === "note") return (await port.listNotes(parentId)).some((n) => n.id !== selfId && collisionKey(kind, n.title) === key);
  return (await port.listFiles(parentId)).some((f) => f.id !== selfId && collisionKey(kind, f.name) === key);
}

/** Name rules for `as`; a note title also follows the title rules. Null when fine. */
function nameError(kind: MoveKind, name: string): string | null {
  if (kind === "note") return requireTitle(name);
  // eslint-disable-next-line no-control-regex -- control characters are never part of a name.
  if (name.trim() === "" || name === "." || name === ".." || /[/\\\u0000-\u001f]/u.test(name)) return "El nombre no es válido.";
  return null;
}

/** Calls the port's move for one piece; `fromParent` and `toParent` are already folder ids. */
function callMove(port: LibraryMovePort, move: PlannedMove, fromParent: string, toParent: string): Promise<{ ok: boolean }> {
  const rename = move.to.name !== move.from.name;
  if (move.kind === "note") return port.moveNote(move.id, { folderId: fromParent, title: move.from.name }, { folderId: toParent, ...(rename ? { title: move.to.name } : {}) });
  if (move.kind === "file") return port.moveFile(move.id, { folderId: fromParent, name: move.from.name }, { folderId: toParent, ...(rename ? { name: move.to.name } : {}) });
  return port.moveFolder(move.id, { parentId: fromParent, name: move.from.name }, { parentId: toParent, ...(rename ? { name: move.to.name } : {}) });
}

/** Where the source is now (parent id and name), or null. A note or file is looked for in `folderId`, else everywhere. */
async function locateSource(port: LibraryMovePort, state: LibraryState, source: MoveSource): Promise<{ parentId: string; name: string } | null> {
  if (source.kind === "folder") {
    const folder = state.folders.find((f) => f.id === source.id);
    return folder && folder.parentId !== null ? { parentId: folder.parentId, name: folder.name } : null;
  }
  const where = source.folderId !== undefined ? [source.folderId] : state.folders.map((f) => f.id);
  for (const folderId of where) {
    if (source.kind === "note") {
      const found = (await port.listNotes(folderId)).find((n) => n.id === source.id);
      if (found) return { parentId: folderId, name: found.title.normalize("NFC") };
    } else {
      const found = (await port.listFiles(folderId)).find((f) => f.id === source.id);
      if (found) return { parentId: folderId, name: found.name.normalize("NFC") };
    }
  }
  return null;
}

/**
 * Plans filing `request.source` inside the folder of an ID (or one subfolder of it), like
 * `jd move`. The ID must be in the JDex. A missing ID folder is planned under its category
 * folder with the name `planNewId` gives it; a missing subfolder is planned too. Nothing is
 * written. Refusals carry a code and never say what is hidden.
 */
export async function planMoveIntoId(port: LibraryMovePort, state: LibraryState, request: MoveRequest): Promise<JdLibraryResult<MovePlan>> {
  const { source } = request;
  const system = request.systemId ?? "";
  if (request.as !== undefined) {
    const error = nameError(source.kind, request.as);
    if (error) return fail("invalid_name", error);
  }
  const subfolder = request.subfolder === undefined ? null : request.subfolder.trim();
  if (subfolder !== null && (nameError("folder", subfolder) !== null || subfolder.startsWith("."))) return fail("invalid_subfolder", "La subcarpeta no es válida: un solo nivel y sin / ni nombre oculto.");
  const parsed = parseJdNumber(request.toId);
  const entry = parsed && parsed.kind === "id" ? findId(state.index, request.toId, system) : undefined;
  if (!entry || !entry.notePath) return fail("id_not_found", `El ID ${request.toId} no está en el JDex.`);
  const entrySystem = entry.system ?? "";

  const current = await locateSource(port, state, source);
  if (!current) return fail("source_not_found", "No se encuentra lo que hay que mover.");
  const name = request.as !== undefined ? request.as.trim() : current.name;

  // Destination: the ID folder (existing or planned) and the subfolder inside it.
  const { jdex } = state.resolved;
  const preconditions: MovePrecondition[] = [{ kind: "folder", role: "jdex", folderId: jdex.id, name: jdex.name }];
  const writes: PlanWrite[] = [];
  const idFolderId = entry.folderPath ? (state.folderIdByPath.get(entry.folderPath) ?? null) : null;
  let folderName: string;
  let dest: { parentId: MoveParent; existing: string | null };
  let nearest: string | null; // deepest folder that exists on the destination chain
  if (idFolderId !== null) {
    folderName = lastSegment(entry.folderPath!);
    preconditions.push({ kind: "folder", role: "id", folderId: idFolderId, name: folderName });
    dest = { parentId: idFolderId, existing: idFolderId };
    nearest = idFolderId;
  } else {
    const category = selectCreationSystem(state.index, entrySystem).categories.find((c) => c.number === entry.category);
    const categoryFolderId = category?.path ? (state.folderIdByPath.get(category.path) ?? null) : null;
    if (!category || categoryFolderId === null || !category.path) return fail("category_folder_not_found", `La categoría ${entry.category} no tiene carpeta.`);
    if (await port.hasHidden(category.number)) return fail("category_has_hidden", `La categoría ${category.number} no admite carpetas nuevas desde aquí.`);
    folderName = idFolderName(entry.id, entry.title, entrySystem);
    preconditions.push({ kind: "folder", role: "category", folderId: categoryFolderId, name: lastSegment(category.path) }, { kind: "not_hidden", category: category.number });
    writes.push({ kind: "ensure_folder", parent: { folderId: categoryFolderId }, name: folderName });
    dest = { parentId: { write: 0 }, existing: null };
    nearest = categoryFolderId;
  }
  if (subfolder !== null) {
    const found = dest.existing === null ? undefined : state.folders.find((f) => f.parentId === dest.existing && nameKey(f.name) === nameKey(subfolder));
    if (found) {
      preconditions.push({ kind: "folder", role: "subfolder", folderId: found.id, name: found.name });
      dest = { parentId: found.id, existing: found.id };
      nearest = found.id;
    } else {
      writes.push({ kind: "ensure_folder", parent: dest.existing === null ? { write: 0 } : { folderId: dest.existing }, name: subfolder });
      dest = { parentId: { write: writes.length - 1 }, existing: null };
    }
  }
  preconditions.push({ kind: "id_in_jdex", id: entry.id, system: entrySystem });

  if (source.kind === "folder") {
    if (chainOf(state.folders, nearest).has(source.id)) return fail("destination_inside_source", "El destino está dentro de la carpeta que se mueve.");
    if (await port.hiddenInside(source.id)) return fail("folder_has_hidden", "Esa carpeta no se puede mover desde aquí.");
    preconditions.push({ kind: "no_hidden_inside", folderId: source.id });
  }
  if (dest.existing !== null && current.parentId === dest.existing && name === current.name) return fail("already_in_destination", "Ya está en ese destino.");
  if (dest.existing !== null && (await nameTaken(port, state, source.kind, dest.existing, name, source.id))) return fail("destination_taken", `En el destino ya hay algo llamado «${name}».`);

  return {
    ok: true,
    value: {
      kind: "move_into_id",
      id: entry.id,
      system: entrySystem,
      resolved: state.resolved,
      destination: { folderName, subfolder },
      preconditions,
      writes,
      moves: [{ kind: source.kind, id: source.id, from: { parentId: current.parentId, name: current.name }, to: { parentId: dest.parentId, name } }],
    },
  };
}

/** Why a precondition no longer holds, or null when it does. */
async function brokenMovePrecondition(port: LibraryMovePort, state: LibraryState, pre: MovePrecondition): Promise<string | null> {
  switch (pre.kind) {
    case "folder":
      return state.folders.some((f) => f.id === pre.folderId && f.name === pre.name.normalize("NFC")) ? null : `la carpeta «${pre.name}» ya no está`;
    case "not_hidden":
      return (await port.hasHidden(pre.category)) ? `la categoría ${pre.category} cambió` : null;
    case "id_in_jdex":
      return findId(state.index, pre.id, pre.system)?.notePath ? null : `el ID ${pre.id} ya no está en el JDex`;
    case "no_hidden_inside":
      return (await port.hiddenInside(pre.folderId)) ? "la carpeta cambió" : null;
  }
}

/** Folder id each `ensure_folder` write resolves to right now WITHOUT creating anything (null = not there). */
function lookUpWrites(state: LibraryState, writes: PlanWrite[]): (string | null)[] {
  const ids: (string | null)[] = [];
  for (const [position, write] of writes.entries()) {
    if (write.kind !== "ensure_folder") {
      ids[position] = null;
      continue;
    }
    const parent = "folderId" in write.parent ? write.parent.folderId : (ids[write.parent.write] ?? null);
    ids[position] = parent === null ? null : (state.folders.find((f) => f.parentId === parent && nameKey(f.name) === nameKey(write.name))?.id ?? null);
  }
  return ids;
}

function parentOf(parent: MoveParent, ids: (string | null)[]): string | null {
  return typeof parent === "string" ? parent : (ids[parent.write] ?? null);
}

/**
 * Re-reads the library, re-checks the plan and, if everything holds, ensures the folders and
 * moves. A move that already happened (an interrupted apply) counts as done. Anything else
 * changed returns `plan_stale` before writing; a port that answers `{ ok: false }` during the
 * moves returns it too, and the folders already created stay. Port exceptions are not caught.
 */
export async function applyMovePlan(port: LibraryMovePort, plan: MovePlan): Promise<JdLibraryResult<MoveOutcome>> {
  const stale = (why: string): JdLibraryResult<MoveOutcome> => fail("plan_stale", `El plan ya no vale: ${why}. No se ha cambiado nada.`);
  const state = await loadLibraryState(port, plan.resolved);
  for (const pre of plan.preconditions) {
    const broken = await brokenMovePrecondition(port, state, pre);
    if (broken) return stale(broken);
  }
  const looked = lookUpWrites(state, plan.writes);
  const done: boolean[] = [];
  for (const [position, move] of plan.moves.entries()) {
    const fromParent = parentOf(move.from.parentId, looked);
    const toParent = parentOf(move.to.parentId, looked);
    if (toParent !== null && (await holds(port, state, move.kind, toParent, move.to.name, move.id))) {
      done[position] = true;
      continue;
    }
    if (fromParent === null || !(await holds(port, state, move.kind, fromParent, move.from.name, move.id))) return stale("lo que se mueve ya no está donde estaba");
    if (toParent !== null) {
      if (await nameTaken(port, state, move.kind, toParent, move.to.name, move.id)) return stale("en el destino ya hay algo con ese nombre");
      if (move.kind === "folder" && chainOf(state.folders, toParent).has(move.id)) return stale("el destino está dentro de la carpeta que se mueve");
    }
  }

  const outcome: MoveOutcome = { created: [], existing: [], moved: [], alreadyDone: [] };
  const folderIds: string[] = [];
  for (const [position, write] of plan.writes.entries()) {
    if (write.kind !== "ensure_folder") continue;
    const parent = "folderId" in write.parent ? write.parent.folderId : folderIds[write.parent.write];
    const result = await port.ensureFolder(parent, write.name);
    folderIds[position] = result.id;
    (result.created ? outcome.created : outcome.existing).push({ kind: "folder", id: result.id, name: write.name });
  }
  for (const [position, move] of plan.moves.entries()) {
    if (done[position]) {
      outcome.alreadyDone.push(move);
      continue;
    }
    const result = await callMove(port, move, parentOf(move.from.parentId, folderIds) as string, parentOf(move.to.parentId, folderIds) as string);
    if (!result.ok) return fail("plan_stale", "El plan ya no vale: lo que se mueve cambió mientras tanto. Las carpetas creadas se quedan.");
    outcome.moved.push(move);
  }
  return { ok: true, value: outcome };
}

/**
 * Pure: the inverse plan. Each piece goes back to its `from` with its old name; the folders
 * the forward plan created are not deleted (the plan keeps its writes only to look them up).
 */
export function planUndoMove(plan: MovePlan): UndoMovePlan {
  return {
    kind: "undo_move",
    resolved: plan.resolved,
    lookups: plan.writes.map((w) => ({ ...w })),
    moves: [...plan.moves].reverse().map((m) => ({ kind: m.kind, id: m.id, from: { ...m.to }, to: { ...m.from } })),
  };
}

/**
 * Puts each piece back if it still is where the apply left it, with the name it left it
 * under. A piece someone else moved or renamed, one whose old place is gone or taken, or one
 * the port refuses, is skipped and reported: there is no global `plan_stale`.
 */
export async function applyUndoMovePlan(port: LibraryMovePort, plan: UndoMovePlan): Promise<JdLibraryResult<UndoMoveOutcome>> {
  const state = await loadLibraryState(port, plan.resolved);
  const looked = lookUpWrites(state, plan.lookups);
  const outcome: UndoMoveOutcome = { restored: [], alreadyRestored: [], skipped: [] };
  for (const move of plan.moves) {
    const fromParent = parentOf(move.from.parentId, looked);
    const toParent = parentOf(move.to.parentId, looked);
    if (toParent !== null && (await holds(port, state, move.kind, toParent, move.to.name, move.id))) {
      outcome.alreadyRestored.push(move);
      continue;
    }
    if (fromParent === null || toParent === null || !(await holds(port, state, move.kind, fromParent, move.from.name, move.id))) {
      outcome.skipped.push({ move, reason: "not_where_left" });
      continue;
    }
    if (await nameTaken(port, state, move.kind, toParent, move.to.name, move.id)) {
      outcome.skipped.push({ move, reason: "destination_taken" });
      continue;
    }
    if (move.kind === "folder" && chainOf(state.folders, toParent).has(move.id)) {
      outcome.skipped.push({ move, reason: "refused" });
      continue;
    }
    const result = await callMove(port, move, fromParent, toParent);
    if (result.ok) outcome.restored.push(move);
    else outcome.skipped.push({ move, reason: "refused" });
  }
  return { ok: true, value: outcome };
}
