/**
 * Hebra side of the optional debug log (`src/jd/debug-log.ts`): one rolling note in the
 * reports folder, fed by `report()` of the runtime. It is written with the checked
 * rewrite of `jdex-write.ts` (the revision read is the revision expected), so a manual
 * edit of the note in between is re-read, not overwritten; it goes straight to the vault
 * and not through the journal, so it is never an «undo» entry. Writes are serialized, a
 * failure is swallowed (the log must not add a failure of its own) and the runtime ignores
 * the notes-change events about this note (`isOwnChange`) so a log line never starts an
 * index update or a maintenance pass.
 */
import type { PluginVault } from 'hebra-plugin-api/v2';
import { appendDebugEntry, DEBUG_LOG_TITLE, formatDebugEntry, type JdexManagerSettings } from './engine';
import { rewriteJdexNotes } from './jdex-write';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

type DebugVault = Pick<PluginVault, 'noteRead' | 'notesPage' | 'noteCreate' | 'notesRewriteBatch'>;

export interface JdexDebugLog {
  /** Adds one line for `error` when the setting is on; never throws. */
  record(where: string, error: unknown, path?: string): Promise<void>;
  /** Whether every note of a notes-change event is the log note itself. */
  isOwnChange(ids: readonly string[]): boolean;
  /** Whether `id` is the log note. */
  isOwn(id: string): boolean;
}

export function createJdexDebugLog(
  vault: DebugVault,
  state: () => { settings: Pick<JdexManagerSettings, 'debugLog' | 'reportsFolder'>; walk: Pick<JdexLibraryWalk, 'folderPaths' | 'rootFolderId'> | null }
): JdexDebugLog {
  let noteId: string | null = null;
  let tail: Promise<void> = Promise.resolve();

  /** The log note of `folderId`: the cached one if it still lives there, else the one titled so, else none. */
  async function findNote(folderId: string): Promise<string | null> {
    if (noteId !== null) {
      const known = await vault.noteRead(noteId);
      if (known && known.trashedAt === null && known.folderId === folderId) return noteId;
      noteId = null;
    }
    let cursor: string | null = null;
    do {
      const page = await vault.notesPage(cursor, 200, { kind: 'folder', folderId });
      const found = page.items.find((note) => note.title === DEBUG_LOG_TITLE);
      if (found) return (noteId = found.id);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return null;
  }

  async function write(entry: string): Promise<void> {
    try {
      const { settings, walk } = state();
      const folderId = settings.reportsFolder === '' || walk === null ? null : jdexResolveFolderId(walk, settings.reportsFolder);
      if (folderId === null) return;
      const existing = await findNote(folderId);
      if (existing === null) {
        noteId = (await vault.noteCreate({ folderId, body: appendDebugEntry(null, entry) })).id;
        return;
      }
      await rewriteJdexNotes(vault, [existing], (current) => appendDebugEntry(current.body, entry), null);
    } catch {
      // A debug log that fails must not add a failure of its own.
    }
  }

  return {
    record(where, error, path) {
      if (!state().settings.debugLog) return Promise.resolve();
      const entry = formatDebugEntry(new Date(), where, error, path);
      const run = tail.then(() => write(entry));
      tail = run.catch(() => undefined);
      return tail;
    },
    isOwn: (id) => id === noteId,
    isOwnChange: (ids) => ids.length > 0 && ids.every((id) => id === noteId)
  };
}
