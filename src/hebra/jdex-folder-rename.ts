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
 */
import type { PluginFolderRenameEvent, PluginModalHandle, PluginUi, PluginVault } from 'hebra-plugin-api';
import type { JdIndex } from './engine';
import { jdexRenameWarning, jdexRenameWarningMessage } from './jdex-rename-guard';
import { mountJdexRenameWarningView } from './jdex-rename-warning-view';
import type { JdexLibraryWalk } from './library-index';

export interface JdexFolderRenameSnapshot {
  walk: JdexLibraryWalk;
  index: JdIndex;
  settings: { jdexFolder: string; systemRoot: string };
}

export interface JdexFolderRenameDeps {
  ui: Pick<PluginUi, 'openModal' | 'notice'>;
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

export function createJdexFolderRenameGuard(deps: JdexFolderRenameDeps): (event: PluginFolderRenameEvent) => Promise<boolean> {
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

  return async (event) => {
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
    if (!warning) return true;
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
}
