/**
 * Commands that act on the ACTIVE note (audit 12 oct 2026, finding 6): send it to its
 * inbox, archive it, copy its ID or its JD path, search inside its category. They are
 * the Hebra counterparts of `send-to-inbox`, `archive`, `copy-id`, `copy-jd-path` and
 * `search-in-category` in Obsidian. Hebra's `PluginCommandDefinition` has no
 * enabled/disabled flag, so "disabled outside an ID" is a notice, never a silent no-op.
 */
import type { HebraPluginApi, PluginActiveNote } from 'hebra-plugin-api';
import { isRepeatedId, locate, repeatedIdMessage, sameSystem, systemKey, type DateFormat, type IdEntry, type JdIndex } from './engine';
import { archiveJdexInboxNote, sendJdexNoteToInbox } from './jdex-inbox-process';
import type { JdexJournal } from './jdex-journal';
import { jdexNotePath, type JdexLibraryWalk, type JdexNoteRef } from './library-index';

export const JDEX_COMMAND_SEND_TO_INBOX = 'jdex-enviar-a-su-inbox';
export const JDEX_COMMAND_ARCHIVE_NOTE = 'jdex-archivar-la-nota';
export const JDEX_COMMAND_COPY_NOTE_ID = 'jdex-copiar-id-de-esta-nota';
export const JDEX_COMMAND_COPY_JD_PATH = 'jdex-copiar-ruta-jd';
export const JDEX_COMMAND_SEARCH_CATEGORY = 'jdex-buscar-en-la-categoria';

type Located = NonNullable<ReturnType<typeof locate>>;

export interface JdexActiveNoteLocation {
  ref: JdexNoteRef;
  located: Located;
}

/** Where the active note lives in the system, or `null` outside every ID. */
export function jdexLocateActiveNote(
  note: PluginActiveNote | null,
  walk: JdexLibraryWalk | null,
  index: JdIndex | null,
  jdexFolder: string
): JdexActiveNoteLocation | null {
  if (!note || !walk || !index) return null;
  // By id first, like the path item: two same-title notes have distinct paths only in the walk.
  const path =
    walk.systemNotes.find((ref) => ref.id === note.id && ref.title === note.title.normalize('NFC') && ref.folderId === note.folderId)?.path ??
    jdexNotePath(walk.folderPaths, note);
  if (!path) return null;
  const located = locate(index, { jdexFolder }, path);
  if (!located) return null;
  return { ref: { id: note.id, folderId: note.folderId, title: note.title, path }, located };
}

/** The JD path of an ID as text («21 Productos … › 21.22 JDex Manager», Obsidian's «Copy
 *  JD path»), never a physical path. The ONE implementation: the active-note command and
 *  the «Copiar ruta JD» action of «Ir a un ID» both copy this. `null` for an entry with
 *  neither note nor folder. */
export function jdexEntryJdPath(index: JdIndex, jdexFolder: string, entry: IdEntry): string | null {
  const path = entry.notePath ?? entry.folderPath;
  return path ? (locate(index, { jdexFolder }, path)?.text ?? null) : null;
}

/** Folder path and label of the category of a located note, from the system folders. */
export function jdexCategoryFolder(index: JdIndex, located: Located): { path: string; label: string } | null {
  const category = index.categories.find((c) => c.number === located.entry.category && sameSystem(c, located.entry));
  return category?.path ? { path: category.path, label: category.label } : null;
}

export interface JdexActiveNoteCommandsDeps {
  api: HebraPluginApi;
  /** Current library state; `null` until the first rebuild. */
  state(): { walk: JdexLibraryWalk; index: JdIndex; jdexFolder: string; dateFormat: DateFormat } | null;
  journal: Pick<JdexJournal, 'run'>;
  rebuild(): Promise<void>;
  copy(text: string, successMessage: string): Promise<void>;
}

export function registerJdexActiveNoteCommands(deps: JdexActiveNoteCommandsDeps): () => void {
  const { api, journal } = deps;
  const notice = (text: string) => api.ui.notice(text);
  const fail = (error: unknown) => notice(error instanceof Error ? error.message : String(error));

  /** The active note inside an ID (or its JDex note when `allowJdexNote`); else a notice. */
  function resolve(allowJdexNote: boolean, pickNoteOrFolder = true) {
    const state = deps.state();
    const found = state ? jdexLocateActiveNote(api.workspace.activeNote(), state.walk, state.index, state.jdexFolder) : null;
    if (!state || !found) {
      notice('Esta nota no vive en el sistema JDex.');
      return null;
    }
    if (!allowJdexNote && found.located.atNote) {
      notice('Esta es la nota JDex del ID: no se envía ni se archiva, solo su contenido.');
      return null;
    }
    // Sending, archiving and the JD path pick "the" note or folder of the number: a
    // repeated one is refused, as everywhere else (`refuseRepeated` in the runtime).
    if (pickNoteOrFolder && isRepeatedId(state.index, found.located.entry)) {
      notice(repeatedIdMessage(found.located.entry));
      return null;
    }
    return { state, ...found };
  }

  const offs = [
    api.ui.registerCommand({
      id: JDEX_COMMAND_SEND_TO_INBOX,
      name: 'JDex: enviar la nota a su inbox (.01)',
      run: async () => {
        const ctx = resolve(false);
        if (!ctx) return;
        try {
          const { label } = await journal.run('move', `Enviar nota a ${ctx.located.entry.category}.01`, (vault) =>
            sendJdexNoteToInbox(vault, ctx.ref, ctx.state.walk, ctx.state.index)
          );
          notice(`Enviada a ${label}.`);
          await deps.rebuild();
        } catch (error) {
          fail(error);
        }
      }
    }),
    api.ui.registerCommand({
      id: JDEX_COMMAND_ARCHIVE_NOTE,
      name: 'JDex: archivar la nota (.09, con fecha)',
      run: async () => {
        const ctx = resolve(false);
        if (!ctx) return;
        try {
          await journal.run('move', 'Archivar la nota abierta', (vault) =>
            archiveJdexInboxNote(vault, api.markdown, ctx.ref, ctx.state.walk, ctx.state.index, ctx.state.dateFormat)
          );
          notice('Nota archivada en su .09.');
          await deps.rebuild();
        } catch (error) {
          fail(error);
        }
      }
    }),
    api.ui.registerCommand({
      id: JDEX_COMMAND_COPY_NOTE_ID,
      name: 'JDex: copiar el ID de esta nota',
      run: async () => {
        // The number itself, the same for every note that repeats it.
        const ctx = resolve(true, false);
        if (!ctx) return;
        const { entry } = ctx.located;
        await deps.copy(systemKey(entry.id, entry.system), 'ID copiado.');
      }
    }),
    api.ui.registerCommand({
      id: JDEX_COMMAND_COPY_JD_PATH,
      name: 'JDex: copiar la ruta JD de esta nota',
      run: async () => {
        const ctx = resolve(true);
        if (!ctx) return;
        // The JD text («Categoría › ID»), never the physical path of the library.
        await deps.copy(jdexEntryJdPath(ctx.state.index, ctx.state.jdexFolder, ctx.located.entry) ?? ctx.located.text, 'Ruta JD copiada.');
      }
    }),
    api.ui.registerCommand({
      id: JDEX_COMMAND_SEARCH_CATEGORY,
      name: 'JDex: buscar dentro de la categoría',
      run: () => {
        // The category's folder, whichever note repeats the number.
        const ctx = resolve(true, false);
        if (!ctx) return;
        const folder = jdexCategoryFolder(ctx.state.index, ctx.located);
        if (!folder) {
          notice('Esta categoría no tiene carpeta donde buscar.');
          return;
        }
        api.workspace.openSearch(`path:"${folder.path}"`);
      }
    })
  ];
  return () => {
    for (const off of offs) off();
  };
}
