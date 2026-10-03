/**
 * «Procesar inbox» (lote 4, tarea 1, encargo de David, 28 sep 2026): recorre las
 * notas directas de cualquier carpeta `.01` (00.01 incluida, `inboxFolders`) una a
 * una. Este fichero es el adaptador: la cola sale de lo que `walkJdexLibrary` ya
 * trajo (sin consulta nueva) y las dos escrituras van por los puertos de la
 * biblioteca (`api.vault`) — `noteMove` para «Mover» y `notesRewriteBatch` (vía
 * `rewriteJdexNotes`) para «Archivar». «Omitir» y «Abrir» no escriben nada, así que
 * no tienen función propia aquí: la vista (`jdex-inbox-process-view.ts`) las resuelve
 * sola.
 */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import { todayIso } from './engine';
import {
  jdexResolveFolderId,
  type JdexInboxSummary,
  type JdexLibraryWalk,
  type JdexNoteRef
} from './library-index';
import { rewriteJdexNotes, type JdexRewriteLibrary } from './jdex-write';

/** Notas directas de cualquier carpeta `.01`, en el mismo orden que
 *  `buildJdexInboxSummary` construyó `summary.folders` (por id de categoría): una por
 *  una, «Procesar inbox» las recorre. */
export function jdexInboxQueue(summary: JdexInboxSummary, walk: JdexLibraryWalk): JdexNoteRef[] {
  const folderIds = new Set(
    summary.folders.map((f) => f.folderId).filter((id): id is string => id !== null)
  );
  return walk.systemNotes.filter((note) => folderIds.has(note.folderId));
}

export type JdexInboxMoveLibrary = Pick<PluginVault, 'noteMove'>;

/** «Mover»: como `moveActiveNoteToEntry` (`jdex-runtime.ts`), la nota va a la carpeta
 *  del ID elegido. `targetFolderPath` viene del ID que el selector de «ir a un ID»
 *  (`jdex-id-picker.ts`) ya filtró a los que SÍ tienen carpeta; aun así se comprueba
 *  aquí, por si la biblioteca cambió entre medias. */
export async function moveJdexInboxNote(
  library: JdexInboxMoveLibrary,
  note: JdexNoteRef,
  walk: Pick<JdexLibraryWalk, 'folderPaths' | 'rootFolderId'>,
  targetFolderPath: string
): Promise<void> {
  const folderId = jdexResolveFolderId(walk, targetFolderPath);
  if (!folderId) throw new Error('No se encontró la carpeta de destino.');
  await library.noteMove(note.id, folderId);
}

/** «Archivar»: mismo criterio que retirar un ID (`retirePlan`, `vendor/jdex-manager/
 *  src/jd/retire.ts`) — `tipo: archivado` y `archivado: <fecha>` en el frontmatter,
 *  conservando el resto de la nota byte a byte (`api.markdown.setProperty`, el mismo
 *  escritor que usa el editor de Hebra). A diferencia de retirar un ID, una nota de
 *  inbox no tiene `.09` a la que mudarse: solo se marca, nunca se mueve. */
export async function archiveJdexInboxNote(
  library: JdexRewriteLibrary,
  markdown: Pick<PluginMarkdown, 'setProperty'>,
  note: JdexNoteRef,
  date = todayIso()
): Promise<{ written: string[]; skipped: string[] }> {
  return rewriteJdexNotes(
    library,
    [note.id],
    (current) => {
      let next = markdown.setProperty(current.body, 'tipo', 'archivado');
      next = markdown.setProperty(next, 'archivado', date);
      return next === current.body ? null : next;
    },
    'Antes de archivar desde el inbox'
  );
}
