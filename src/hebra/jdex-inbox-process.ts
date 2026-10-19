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
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api/v2';
import { applyMovePlan, datedName, idFolderOfPath, planMoveIntoId, zeroOf, type DateFormat, type IdEntry, type JdIndex, type JdexManagerSettings } from './engine';
import { HebraMovePort, jdexLibraryState, type HebraMoveVault } from './library-port-adapter';
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

/** Lo que «Mover» necesita para planificar (lecturas) y del diario para escribir. */
export interface JdexInboxMoveContext {
  readonly index: JdIndex;
  readonly settings: Partial<JdexManagerSettings>;
  /** La biblioteca, solo para planificar; la escritura va por el `vault` del diario. */
  readonly library: HebraMoveVault;
  readonly markdown: Pick<PluginMarkdown, 'withTitle'>;
  /** Abre una entrada del diario (`journal.run`) y entrega su `vault`. */
  readonly run: (action: (vault: PluginVault) => Promise<unknown>) => Promise<unknown>;
}

/** «Mover» desde el inbox por el motor compartido (`planMoveIntoId` y `applyMovePlan`, como
 *  `hebra_jd_move` y «Mover la nota abierta aquí»): crea la carpeta del ID si falta, rechaza un
 *  nombre ocupado en el destino y mueve con guarda (`noteMoveIfUnchanged` vía `HebraMovePort`).
 *  Lanza con el mensaje del motor, que la vista pone en su banner; un rechazo del plan no abre
 *  el diario. El nombre no se fecha (en Hebra el nombre es el título). */
export async function moveJdexInboxNote(
  note: JdexNoteRef,
  entry: IdEntry,
  walk: JdexLibraryWalk,
  context: JdexInboxMoveContext
): Promise<void> {
  const jdexFolderId = jdexResolveFolderId(walk, context.settings.jdexFolder ?? '');
  if (!jdexFolderId) throw new Error('No se encontró la carpeta del JDex.');
  const planned = await planMoveIntoId(
    new HebraMovePort(context.library, context.markdown),
    jdexLibraryState(walk, context.index, context.settings, jdexFolderId),
    { source: { kind: 'note', id: note.id, folderId: note.folderId }, toId: entry.id, systemId: entry.system ?? '' }
  );
  if (!planned.ok) throw new Error(planned.message);
  const plan = planned.value;
  await context.run(async (vault) => {
    const applied = await applyMovePlan(new HebraMovePort(vault, context.markdown), plan);
    if (!applied.ok) throw new Error(applied.message);
  });
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

/** The `.01` or `.09` of the category that owns the note's folder, whatever ID that
 *  folder belongs to (an inbox, a content ID, the archive itself). `null` when the
 *  folder is outside every ID or the category has no live folder for that zero. */
export function jdexZeroTarget(
  note: Pick<JdexNoteRef, 'folderId'>,
  walk: Pick<JdexLibraryWalk, 'folderPaths' | 'rootFolderId'>,
  index: JdIndex,
  zero: '01' | '09'
): { folderId: string; label: string } | null {
  const folderPath = walk.folderPaths.get(note.folderId);
  if (folderPath === undefined || folderPath === '') return null;
  const owner = idFolderOfPath(index, `${folderPath}/_`);
  if (!owner) return null;
  const target = zeroOf(index, owner.category, zero, owner.system ?? '');
  const folderId = target?.folderPath ? jdexResolveFolderId(walk, target.folderPath) : null;
  return target && folderId ? { folderId, label: target.label } : null;
}

/** «Enviar a su inbox»: moves the note to the `.01` of its category (no dating). */
export async function sendJdexNoteToInbox(
  library: Pick<PluginVault, 'noteMove'>,
  note: JdexNoteRef,
  walk: JdexLibraryWalk,
  index: JdIndex
): Promise<{ label: string }> {
  const target = jdexZeroTarget(note, walk, index, '01');
  if (!target) throw new Error('Esta categoría no tiene una carpeta .01 a la que enviarla.');
  if (target.folderId === note.folderId) throw new Error(`La nota ya está en ${target.label}.`);
  await library.noteMove(note.id, target.folderId);
  return { label: target.label };
}

/** Move to `.09` with the note creation date prefixed to its title. A stale title
 *  rewrite aborts before the move; a later move failure remains in the journal.
 *  The origin may be any ID of the category (not only its `.01`). */
export async function archiveJdexInboxNote(
  library: Pick<PluginVault, 'noteRead' | 'notesRewriteBatch' | 'noteMoveIfUnchanged'>,
  markdown: Pick<PluginMarkdown, 'withTitle'>,
  note: JdexNoteRef,
  walk: JdexLibraryWalk,
  index: JdIndex,
  dateFormat: DateFormat
): Promise<void> {
  const target = jdexZeroTarget(note, walk, index, '09');
  if (!target) throw new Error('Esta categoría no tiene una carpeta .09 para archivar.');
  if (target.folderId === note.folderId) throw new Error(`La nota ya está en ${target.label}.`);
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

/** Send an inbox note to the library trash, only if it is still where the dialog saw it. */
export async function trashJdexInboxNote(
  library: Pick<PluginVault, 'noteRead' | 'noteTrashIfUnchanged'>,
  note: JdexNoteRef
): Promise<void> {
  const current = await library.noteRead(note.id);
  if (!current || current.trashedAt !== null || current.folderId !== note.folderId) {
    throw new Error('La nota cambió desde que se abrió el inbox; vuelve a abrirlo.');
  }
  const trashed = await library.noteTrashIfUnchanged(note.id, { revision: current.revision, folderId: current.folderId });
  if (!trashed) throw new Error('La nota cambió antes de mandarla a la papelera; se conserva en el inbox.');
}
