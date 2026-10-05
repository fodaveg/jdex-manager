/**
 * «Sección del ID en el panel de contexto» (lote 4, tarea 2, encargo de David, 28 sep
 * 2026): adaptador que calcula lo que pide el encargo — ruta, descripción, ficheros
 * de la carpeta con su fecha, hijos («+», `childrenPlus`) y hermanos (mismo
 * `category`) — para la nota activa. Se pide SOLO mientras la pestaña está montada
 * (`jdex-id-section-view.ts`), como el resto de pestañas del panel de contexto
 * (JSDoc de `LibraryContextPanel.svelte`): `notesPage`/`filesPage` del folder del ID
 * son dos consultas nuevas, nunca proporcionales al tamaño de la biblioteca.
 */
import type { PluginActiveNote, PluginVault } from 'hebra-plugin-api';
import { childrenPlus, locate, sameSystem, type IdEntry, type JdIndex, type Location } from './engine';
import {
  jdexFrontmatterString,
  readJdexFrontmatter,
  type JdexFrontmatterMarkdown
} from './frontmatter';
import { jdexNotePath, jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

/** Lo que usa la sección del `vault` de la API. */
export type JdexIdSectionLibrary = Pick<PluginVault, 'noteRead' | 'notesPage' | 'filesPage'>;

export interface JdexIdSectionFile {
  readonly name: string;
  readonly date: number;
  readonly kind: 'note' | 'file';
  /** Solo para `kind: 'note'`: permite abrirla. */
  readonly id?: string;
}

export interface JdexIdSectionData {
  readonly located: Location | null;
  readonly entry: IdEntry | null;
  readonly categoryLabel: string;
  readonly description: string;
  readonly files: readonly JdexIdSectionFile[];
  readonly children: readonly IdEntry[];
  readonly siblings: readonly IdEntry[];
}

const FOLDER_CONTENTS_LIMIT = 200;

const EMPTY: JdexIdSectionData = {
  located: null,
  entry: null,
  categoryLabel: '',
  description: '',
  files: [],
  children: [],
  siblings: []
};

async function folderContents(
  library: JdexIdSectionLibrary,
  folderId: string
): Promise<JdexIdSectionFile[]> {
  const [notes, files] = await Promise.all([
    library.notesPage(null, FOLDER_CONTENTS_LIMIT, { kind: 'folder', folderId }),
    library.filesPage(folderId, false, null, FOLDER_CONTENTS_LIMIT)
  ]);
  const out: JdexIdSectionFile[] = [
    ...notes.items.map((item) => ({
      name: item.title,
      date: item.updatedAt,
      kind: 'note' as const,
      id: item.id
    })),
    ...files.items.map((item) => ({ name: item.name, date: item.updatedAt, kind: 'file' as const }))
  ];
  out.sort((a, b) => b.date - a.date);
  return out;
}

export async function loadJdexIdSection(
  library: JdexIdSectionLibrary,
  markdown: JdexFrontmatterMarkdown,
  walk: JdexLibraryWalk,
  index: JdIndex,
  settings: { jdexFolder: string },
  activeNote: PluginActiveNote | null
): Promise<JdexIdSectionData> {
  if (!activeNote) return EMPTY;
  const path = jdexNotePath(walk.folderPaths, activeNote);
  if (!path) return EMPTY;
  const located = locate(index, settings, path);
  if (!located) return EMPTY;
  const entry = located.entry;
  const category = index.categories.find((c) => c.number === entry.category && sameSystem(c, entry));

  let description = '';
  if (entry.notePath) {
    const noteId = walk.systemNotes.find((n) => n.path === entry.notePath)?.id;
    if (noteId) {
      const row = await library.noteRead(noteId);
      if (row?.body != null) {
        description = jdexFrontmatterString(readJdexFrontmatter(row.body, markdown), 'descripcion');
      }
    }
  }

  let files: JdexIdSectionFile[] = [];
  if (entry.folderPath) {
    const folderId = jdexResolveFolderId(walk, entry.folderPath);
    if (folderId) files = await folderContents(library, folderId);
  }

  const children = childrenPlus(index, entry.id, entry.system);
  const siblings = index.ids.filter(
    (candidate) =>
      candidate.category === entry.category && sameSystem(candidate, entry) &&
      candidate.id !== entry.id &&
      !candidate.id.endsWith('+')
  );

  return {
    located,
    entry,
    categoryLabel: category?.label ?? entry.category,
    description,
    files,
    children,
    siblings
  };
}
