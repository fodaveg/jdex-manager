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

import type { LibraryPort } from "./library-port";
import type { ApplyOutcome, JdLibraryResult, LibraryState, PlanWrite, ResolvedSettings } from "./create-id";

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

/** Plans filing `request.source` into the ID folder. Nothing is written. */
export async function planMoveIntoId(_port: LibraryMovePort, _state: LibraryState, _request: MoveRequest): Promise<JdLibraryResult<MovePlan>> {
  throw new Error("planMoveIntoId: not implemented");
}

/** Re-checks the plan against the library and, if it holds, creates the folders and moves. `plan_stale` writes nothing. */
export async function applyMovePlan(_port: LibraryMovePort, _plan: MovePlan): Promise<JdLibraryResult<MoveOutcome>> {
  throw new Error("applyMovePlan: not implemented");
}

/** Pure: the plan that puts every piece back where it was, with its old name. Folders it created stay. */
export function planUndoMove(_plan: MovePlan): UndoMovePlan {
  throw new Error("planUndoMove: not implemented");
}

/** Puts back each piece still where the apply left it; the others are skipped and reported. */
export async function applyUndoMovePlan(_port: LibraryMovePort, _plan: UndoMovePlan): Promise<JdLibraryResult<UndoMoveOutcome>> {
  throw new Error("applyUndoMovePlan: not implemented");
}
