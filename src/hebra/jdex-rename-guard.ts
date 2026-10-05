/**
 * «JDex: avisar antes de renumerar un ID o cambiarlo de categoría al renombrar o
 * mover» (lote 3, tarea 1, encargo de David, 28 sep 2026). Solo AVISA: nunca actúa
 * sola ni reescribe nada — Hebra sigue su camino de escritura normal
 * (`folderRename`/`folderMove`) si el usuario confirma, y no hace nada si cancela.
 *
 * Pura: calcula la ruta vieja y la nueva con lo que `jdex-runtime.ts` ya tiene
 * cacheado (`JdexLibraryWalk`, del último `rebuild()`) y se lo pasa a `pairAction`
 * del motor (contrato del 28 sep 2026, punto 3: «pairAction(...) por evento, con
 * índice DESPUÉS del rename» — aquí, con el índice de ANTES, porque preguntamos
 * antes de escribir, no después).
 *
 * Tres resultados de `pairAction` justifican preguntar:
 * «unnumbered» (se pierde el número), «renumbered» (el número cambia) y «moved» (el ID cambiaría de categoría
 * o área). «rename-partner» es la sincronización de la pareja nota/carpeta — otra
 * tarea, no esta — y «none» no cambia nada del sistema JDex.
 */
import type { PluginFolderRenameEvent } from 'hebra-plugin-api';
import { pairAction, type JdIndex, type PairAction } from './engine';
import { jdexNoteFileStem, type JdexLibraryWalk } from './library-index';

/**
 * Lo que mira el aviso: los eventos de carpeta que da `workspace.onBeforeFolderRename`
 * (`newParentId: null` es la raíz de la biblioteca) más el cambio de TÍTULO de una nota,
 * que llega DESPUÉS de guardar por `workspace.onNoteTitleRenamed` y el runtime convierte
 * en este evento (lote 5, 29 sep 2026).
 */
export type JdexRenameGuardEvent =
  | PluginFolderRenameEvent
  | { kind: 'note-rename'; noteId: string; newTitle: string };

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Los resultados de `PairAction` que justifican preguntar (ver la
 *  cabecera del fichero). */
export type JdexRenameWarningAction = Extract<
  PairAction,
  { type: 'renumbered' } | { type: 'moved' } | { type: 'unnumbered' }
>;

/** `null` = sin aviso, deja pasar el renombrado o el movimiento. */
export function jdexRenameWarning(
  event: JdexRenameGuardEvent,
  walk: JdexLibraryWalk,
  index: JdIndex,
  settings: { jdexFolder: string; systemRoot: string }
): JdexRenameWarningAction | null {
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let isFolder = false;

  if (event.kind === 'folder-rename') {
    isFolder = true;
    oldPath = walk.folderPaths.get(event.folderId);
    if (oldPath === undefined) return null;
    const parent = parentPath(oldPath);
    newPath = parent ? `${parent}/${event.newName}` : event.newName;
  } else if (event.kind === 'folder-move') {
    isFolder = true;
    oldPath = walk.folderPaths.get(event.folderId);
    if (oldPath === undefined) return null;
    const name = baseName(oldPath);
    // `newParentId === null` es la raíz de la biblioteca: su ruta es '' y no tiene
    // entrada propia en `folderPaths` (`jdexFolderPaths` solo mapea carpetas VIVAS).
    const newParentPath = event.newParentId === null ? '' : walk.folderPaths.get(event.newParentId);
    if (newParentPath === undefined) return null;
    newPath = newParentPath ? `${newParentPath}/${name}` : name;
  } else {
    const note = walk.systemNotes.find((entry) => entry.id === event.noteId);
    if (!note) return null;
    oldPath = note.path;
    const parent = parentPath(oldPath);
    const title = event.newTitle.normalize('NFC');
    newPath = parent ? `${parent}/${jdexNoteFileStem(title)}.md` : `${jdexNoteFileStem(title)}.md`;
  }

  if (oldPath === newPath) return null;
  const action = pairAction({ oldPath, newPath, isFolder }, index, settings);
  return action.type === 'renumbered' || action.type === 'moved' || action.type === 'unnumbered' ? action : null;
}

/** El texto del aviso, uno por tipo de `PairAction`, con sus datos exactos. */
export function jdexRenameWarningMessage(action: JdexRenameWarningAction): string {
  if (action.type === 'unnumbered') {
    return `«${action.oldId}» perdería su número: un ID nunca se renumera (johnnydecimal.com). ¿Seguro que quieres continuar?`;
  }
  if (action.type === 'renumbered') {
    return (
      `«${action.oldId}» pasaría a «${action.newId}»: un ID nunca se renumera ` +
      `(johnnydecimal.com). ¿Seguro que quieres continuar?`
    );
  }
  return (
    `«${action.id}» cambiaría de categoría o área, de «${action.from}» a «${action.to}». ` +
    `¿Seguro que quieres continuar?`
  );
}

/**
 * El texto del aviso NO bloqueante tras GUARDAR el título de una nota (lote 5, 29
 * sep 2026): a diferencia de `jdexRenameWarningMessage` (pregunta ANTES de escribir,
 * para carpetas), aquí el guardado ya ocurrió, así que se cuenta en pasado y el
 * propio aviso es el botón de deshacer (`host.notice(text, onClick)`, `onClick` =
 * `event.undo()` en `jdex-runtime.ts`).
 */
export function jdexRenameNoticeMessage(action: JdexRenameWarningAction): string {
  if (action.type === 'unnumbered') {
    return `«${action.oldId}» ha perdido su número: un ID nunca se renumera (johnnydecimal.com). Deshacer.`;
  }
  if (action.type === 'renumbered') {
    return (
      `«${action.oldId}» ha pasado a «${action.newId}»: un ID nunca se renumera ` +
      `(johnnydecimal.com). Deshacer.`
    );
  }
  return (
    `«${action.id}» ha cambiado de categoría o área, de «${action.from}» a «${action.to}». ` +
    `Deshacer.`
  );
}
