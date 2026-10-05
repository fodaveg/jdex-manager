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
import { datedName, zeroOf, type DateFormat, type JdIndex } from './engine';
import {
  jdexResolveFolderId,
  type JdexInboxSummary,
  type JdexLibraryWalk,
  type JdexNoteRef
} from './library-index';

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

/** A note in `.01` can be archived only when its own category has a live `.09` folder. */
export function jdexInboxArchiveTarget(
  note: JdexNoteRef,
  walk: JdexLibraryWalk,
  index: JdIndex
): { folderId: string; label: string } | null {
  const inboxPath = walk.folderPaths.get(note.folderId);
  const inbox = index.ids.find((entry) => entry.folderPath === inboxPath && entry.id.endsWith('.01'));
  if (!inbox) return null;
  const archive = zeroOf(index, inbox.category, '09', inbox.system ?? '');
  const folderId = archive?.folderPath ? jdexResolveFolderId(walk, archive.folderPath) : null;
  return archive && folderId ? { folderId, label: archive.label } : null;
}

/** Move to `.09` with the note creation date prefixed to its title. A stale title
 *  rewrite aborts before the move; a later move failure remains in the journal. */
export async function archiveJdexInboxNote(
  library: Pick<PluginVault, 'noteRead' | 'notesRewriteBatch' | 'noteMoveIfUnchanged'>,
  markdown: Pick<PluginMarkdown, 'withTitle'>,
  note: JdexNoteRef,
  walk: JdexLibraryWalk,
  index: JdIndex,
  dateFormat: DateFormat
): Promise<void> {
  const target = jdexInboxArchiveTarget(note, walk, index);
  if (!target) throw new Error('Esta categoría no tiene una carpeta .09 para archivar.');
  const current = await library.noteRead(note.id);
  if (!current || current.body === null || current.trashedAt !== null || current.folderId !== note.folderId) {
    throw new Error('La nota cambió desde que se abrió el inbox; vuelve a abrirlo.');
  }
  let revision = current.revision;
  const title = datedName(current.title, new Date(current.createdAt), dateFormat);
  if (title !== current.title) {
    const body = markdown.withTitle(current.body, title);
    if (body === current.body) throw new Error('No se pudo poner la fecha al título de la nota.');
    const result = await library.notesRewriteBatch([{ id: note.id, body, expected: current.revision, strictRevision: true }], { cause: 'Antes de archivar desde el inbox' });
    if (!result.written.includes(note.id)) throw new Error('La nota cambió antes de fecharla; no se archivó.');
    const committed = result.committed.find((entry) => entry.id === note.id);
    if (!committed) throw new Error('Hebra no devolvió la revisión exacta; la nota fechada se conserva en el inbox.');
    revision = committed.revision;
  }
  if (!await library.noteMoveIfUnchanged(note.id, target.folderId, { revision, folderId: current.folderId })) throw new Error('La nota cambió antes de moverla al archivo; se conserva en el inbox.');
}
