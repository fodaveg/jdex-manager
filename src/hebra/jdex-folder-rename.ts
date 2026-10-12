/**
 * The folder rename guard (`api.workspace.onBeforeFolderRename`) that never lets an ID be
 * renumbered, unnumbered or moved to another category without an explicit answer from the
 * user (audit of 12 Oct 2026, task a17a3b63).
 *
 * Why it does not simply wait for the dialog: Hebra's `confirmFolderRename`
 * (`workspace-bridge.ts`) waits at most `FOLDER_RENAME_GUARD_TIMEOUT_MS` (5 s) per guard
 * and treats a timeout or a thrown error as «allow». A guard that waits for a human
 * therefore lets the renumbering through after 5 s, and any bug in it does the same.
 *
 * So the guard answers `false` AT ONCE whenever the change needs a warning, and only then
 * asks. If the user confirms, the plugin performs that same change itself with
 * `folderRenameIfUnchanged` / `folderMoveIfUnchanged` (which do not pass through the
 * guard), journaled so «Deshacer» can revert it, and only if the folder still has the name
 * and parent it had when the user was asked. Cancel, Escape, closing the dialog, a timeout
 * or an error all leave the folder exactly as it was. A failure inside the check also
 * answers `false`: it never fails open.
 *
 * Rename in pairs, folder to note (task 88fc7c95): a rename that keeps the number but
 * changes the title is let through and remembered. Its note rename is offered (a
 * clickable notice) or done (`renamePairsWithoutAsking`) only when `onFoldersChange` shows
 * the folder with the new name, so a rename that failed or was cancelled by another guard
 * never renames the note.
 */
import type { PluginFolder, PluginFolderRenameEvent, PluginMarkdown, PluginModalHandle, PluginUi, PluginVault } from 'hebra-plugin-api';
import { extractJdPrefix, isRepeatedId, repeatedIdMessage, type JdIndex } from './engine';
import { jdexFolderPairBlockedByRepeat, jdexFolderPairRename, jdexPairNoticeMessage, jdexRenameWarning, jdexRenameWarningMessage } from './jdex-rename-guard';
import { mountJdexRenameWarningView } from './jdex-rename-warning-view';
import type { JdexLibraryWalk } from './library-index';

export interface JdexFolderRenameSnapshot {
  walk: JdexLibraryWalk;
  index: JdIndex;
  settings: { jdexFolder: string; systemRoot: string; renamePairsWithoutAsking: boolean };
}

/** How long a folder rename the guard let through may take to show up as done before its
 *  pending note rename is forgotten (a failed or cancelled rename never shows up). */
export const JDEX_PAIR_RENAME_TTL_MS = 60_000;

interface PendingPair {
  folderId: string;
  oldName: string;
  newName: string;
  noteId: string;
  oldTitle: string;
  newTitle: string;
  at: number;
}

export interface JdexFolderRenameGuard {
  /** `api.workspace.onBeforeFolderRename`. */
  confirm: (event: PluginFolderRenameEvent) => Promise<boolean>;
  /** `api.workspace.onFoldersChange`: a pending pair whose folder now has the new name has
   *  been renamed for real, so its note rename is offered (or done) now, never before. */
  foldersChanged: (folders: readonly PluginFolder[]) => void;
}

export interface JdexFolderRenameDeps {
  ui: Pick<PluginUi, 'openModal' | 'notice'>;
  markdown: Pick<PluginMarkdown, 'withTitle'>;
  now?: () => number;
  /** The last built index, or `null` while the first one is being built. */
  snapshot(): JdexFolderRenameSnapshot | null;
  /** Runs a library write in the journal and refreshes the index afterwards. */
  write(label: string, action: (vault: PluginVault) => Promise<void>): Promise<void>;
  report(error: unknown, where: string): void;
}

const CHANGED = 'La carpeta cambió desde el aviso; no se ha tocado.';

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function createJdexFolderRenameGuard(deps: JdexFolderRenameDeps): JdexFolderRenameGuard {
  const now = (): number => (deps.now ? deps.now() : Date.now());
  /** Folder renames let through whose note should follow, by folder id. */
  const pending = new Map<string, PendingPair>();

  /** Folder to note: the note takes the folder's new title, only if it still has the title
   *  it had when the folder rename was let through. */
  async function renameNote(pair: PendingPair): Promise<void> {
    await deps.write(`Renombrar nota ${pair.oldTitle}`, async (vault) => {
      const note = await vault.noteRead(pair.noteId);
      if (!note || note.body === null || note.trashedAt !== null || note.title !== pair.oldTitle) throw new Error('La nota cambió desde el aviso; no se ha tocado.');
      const body = deps.markdown.withTitle(note.body, pair.newTitle);
      if (body === note.body) throw new Error('No se pudo cambiar el título de la nota.');
      const result = await vault.notesRewriteBatch([{ id: note.id, body, expected: note.revision, strictRevision: true }], { cause: 'Renombrar en pareja' });
      if (!result.written.includes(note.id)) throw new Error('La nota cambió desde el aviso; no se ha tocado.');
    });
  }

  function foldersChanged(folders: readonly PluginFolder[]): void {
    for (const pair of [...pending.values()]) {
      const folder = folders.find((entry) => entry.id === pair.folderId);
      const expired = now() - pair.at > JDEX_PAIR_RENAME_TTL_MS;
      if (!folder || expired || (folder.name !== pair.oldName && folder.name !== pair.newName)) {
        pending.delete(pair.folderId);
        continue;
      }
      if (folder.name !== pair.newName) continue; // not renamed (yet)
      pending.delete(pair.folderId);
      const run = (): void => {
        void renameNote(pair).catch((error: unknown) => deps.ui.notice(error instanceof Error ? error.message : String(error)));
      };
      if (deps.snapshot()?.settings.renamePairsWithoutAsking) run();
      else deps.ui.notice(jdexPairNoticeMessage('note', pair.oldTitle, pair.newTitle), run);
    }
  }

  /** Remembers a title-only folder rename so its note follows once it is done. */
  function trackPair(event: PluginFolderRenameEvent, snapshot: JdexFolderRenameSnapshot): void {
    const action = jdexFolderPairRename(event, snapshot.walk, snapshot.index, snapshot.settings);
    const oldPath = snapshot.walk.folderPaths.get(event.folderId);
    if (!action && event.kind === 'folder-rename' && jdexFolderPairBlockedByRepeat(event, snapshot.walk, snapshot.index, snapshot.settings)) {
      // The number is repeated: the folder rename goes ahead, its note does not follow.
      const renamed = extractJdPrefix(event.newName);
      if (renamed?.number.kind === 'id') {
        deps.ui.notice(repeatedIdMessage({ id: renamed.number.extension ? `${renamed.number.id}+` : renamed.number.id, system: renamed.number.system }));
      }
      return;
    }
    if (!action || oldPath === undefined || event.kind !== 'folder-rename') return;
    const note = snapshot.walk.systemNotes.find((entry) => entry.path === action.partnerPath);
    if (!note) return;
    // A repeated number: "the" note of this folder could be the other ID's. The folder
    // rename goes ahead (the user's own change); its note does not follow.
    const parsed = extractJdPrefix(note.title);
    if (parsed?.number.kind === 'id') {
      const entry = { id: parsed.number.extension ? `${parsed.number.id}+` : parsed.number.id, system: parsed.number.system, title: parsed.title };
      if (isRepeatedId(snapshot.index, entry)) {
        deps.ui.notice(repeatedIdMessage(entry));
        return;
      }
    }
    const newTitle = baseName(action.newPartnerPath).replace(/\.md$/u, '');
    pending.set(event.folderId, { folderId: event.folderId, oldName: baseName(oldPath), newName: event.newName, noteId: note.id, oldTitle: note.title, newTitle, at: now() });
  }

  /** The change the user was asked about, performed only if nothing moved meanwhile. */
  async function replay(event: PluginFolderRenameEvent, snapshot: JdexFolderRenameSnapshot, oldPath: string): Promise<void> {
    const label = event.kind === 'folder-rename' ? `Renombrar carpeta ${baseName(oldPath)}` : `Mover carpeta ${baseName(oldPath)}`;
    await deps.write(label, async (vault) => {
      const folder = (await vault.foldersList()).find((entry) => entry.id === event.folderId);
      const root = vault.rootFolderId();
      const pathOfParent = (id: string | null): string | undefined => (id === null || id === root ? '' : snapshot.walk.folderPaths.get(id));
      if (!folder || folder.name !== baseName(oldPath) || pathOfParent(folder.parentId) !== parentPath(oldPath)) throw new Error(CHANGED);
      const expected = { name: folder.name, parentId: folder.parentId };
      const done =
        event.kind === 'folder-rename'
          ? await vault.folderRenameIfUnchanged(folder.id, event.newName, expected)
          : await vault.folderMoveIfUnchanged(folder.id, event.newParentId, expected);
      if (!done) throw new Error(CHANGED);
    });
  }

  const confirm = async (event: PluginFolderRenameEvent): Promise<boolean> => {
    const snapshot = deps.snapshot();
    // While the first index is being built nothing is known about this folder.
    if (!snapshot) return true;
    let warning: ReturnType<typeof jdexRenameWarning>;
    try {
      warning = jdexRenameWarning(event, snapshot.walk, snapshot.index, snapshot.settings);
    } catch (error) {
      deps.report(error, 'guardia-de-renombrado');
      deps.ui.notice('JDex no pudo comprobar este cambio de carpeta y no lo ha hecho. Vuelve a intentarlo.');
      return false;
    }
    if (!warning) {
      // Same number: Hebra renames now; the note follows only once that rename is done.
      try {
        trackPair(event, snapshot);
      } catch (error) {
        deps.report(error, 'renombrado-en-pareja');
      }
      return true;
    }
    const oldPath = snapshot.walk.folderPaths.get(event.folderId);
    if (oldPath === undefined) return false;
    let handle: PluginModalHandle | undefined;
    try {
      handle = deps.ui.openModal(
        (el) =>
          mountJdexRenameWarningView(el, {
            message: jdexRenameWarningMessage(warning),
            confirmLabel: event.kind === 'folder-rename' ? 'Renombrar igualmente' : 'Mover igualmente',
            onContinue: () => {
              handle?.close();
              void replay(event, snapshot, oldPath).catch((error: unknown) =>
                deps.ui.notice(error instanceof Error ? error.message : String(error))
              );
            },
            onCancel: () => handle?.close()
          }),
        // Escape or a click outside close without deciding: the change is already refused.
        { title: 'JDex: confirmar' }
      );
    } catch (error) {
      deps.report(error, 'guardia-de-renombrado');
    }
    // Refused now, whatever the dialog does later: the host never renames on its own.
    return false;
  };

  return { confirm, foldersChanged };
}
