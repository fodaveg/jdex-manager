/**
 * «Sección del ID en el panel de contexto» (lote 4, tarea 2, encargo de David, 28 sep
 * 2026): adaptador que calcula lo que pide el encargo — ruta, descripción, ficheros
 * de la carpeta con su fecha, hijos («+», `childrenPlus`) y hermanos (mismo
 * `category`) — para la nota activa. Se pide SOLO mientras la pestaña está montada
 * (`jdex-id-section-view.ts`), como el resto de pestañas del panel de contexto
 * (JSDoc de `LibraryContextPanel.svelte`): `notesPage`/`filesPage` del folder del ID
 * son dos consultas nuevas, nunca proporcionales al tamaño de la biblioteca.
 */
import type { PluginActiveNote, PluginVault } from 'hebra-plugin-api/v2';
import { childrenOf, childrenPlus, locate, sameSystem, type IdEntry, type JdIndex, type Location } from './engine';
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
  /** Siblings under the header of the ID (as in Obsidian), the ID itself excluded. */
  readonly siblings: readonly IdEntry[];
  /** «Bajo 21.10 Cabecera», or `''` when the ID hangs from no header (`.01`-`.09`, `+`). */
  readonly siblingsTitle?: string;
  /** The folder holds more than `FOLDER_CONTENTS_LIMIT` notes and/or files than were listed. */
  readonly truncated?: { readonly notes: boolean; readonly files: boolean };
  /** How many notes/files each list is capped at, for the notice. */
  readonly contentsLimit?: number;
}

export const FOLDER_CONTENTS_LIMIT = 200;

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
): Promise<{ files: JdexIdSectionFile[]; truncated: { notes: boolean; files: boolean } }> {
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
  // Most recently updated first (Obsidian sorts by name; Hebra's panel is a "what changed" view).
  out.sort((a, b) => b.date - a.date);
  return { files: out, truncated: { notes: notes.nextCursor !== null, files: files.nextCursor !== null } };
}

/** Siblings of an ID as Obsidian's panel lists them: the IDs under the same header range
 *  (`childrenOf`), never the whole category. Empty title when the ID has no header. */
export function jdexSiblingsUnderHeader(
  index: JdIndex,
  entry: IdEntry
): { title: string; siblings: IdEntry[] } {
  const last = Number(entry.id.split('.')[1]);
  const tens = Math.floor(last / 10) * 10;
  if (!Number.isFinite(tens) || tens === 0 || entry.id.endsWith('+')) return { title: '', siblings: [] };
  const headerId = `${entry.category}.${tens}`;
  const header = index.ids.find((e) => e.id === headerId && sameSystem(e, entry));
  const all = childrenOf(index, headerId, entry.system);
  if (all.length <= 1 && !header) return { title: '', siblings: [] };
  const prefix = headerId.slice(0, -1);
  return {
    title: header ? `Bajo ${header.label}` : `${prefix}1 a ${prefix}9`,
    siblings: all.filter((candidate) => candidate.id !== entry.id)
  };
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
  let truncated = { notes: false, files: false };
  if (entry.folderPath) {
    const folderId = jdexResolveFolderId(walk, entry.folderPath);
    if (folderId) ({ files, truncated } = await folderContents(library, folderId));
  }

  const children = childrenPlus(index, entry.id, entry.system);
  const { title: siblingsTitle, siblings } = jdexSiblingsUnderHeader(index, entry);

  return {
    located,
    entry,
    categoryLabel: category?.label ?? entry.category,
    description,
    files,
    children,
    siblings,
    siblingsTitle,
    truncated,
    contentsLimit: FOLDER_CONTENTS_LIMIT
  };
}
