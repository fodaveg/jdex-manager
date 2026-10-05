/**
 * Adaptador entre la biblioteca de Hebra (`api.vault`) y el motor puro de JDex
 * (`./engine.ts`): las carpetas y notas de la biblioteca no llevan una ruta de fichero
 * (Hebra identifica por id y deriva el título del cuerpo), así que aquí se construye la
 * ruta relativa «con /» que el motor espera, EXACTAMENTE como la vería Obsidian:
 * sensible a mayúsculas, sin barra inicial ni final, normalizada a NFC (contrato del 28
 * sep 2026, sesión de JDex).
 *
 * Una consulta por carpeta VIVA bajo la raíz del sistema (`notesPage(…, {kind:'folder',
 * folderId, subfolders:false})`, paginada), nunca una por nota: con ~3.300 notas
 * repartidas en unos cientos de carpetas de sistema, el número de idas y vueltas es el
 * de las CARPETAS, no el de las notas (medido en `library-index.test.ts`, fixture de
 * 3.300 notas).
 */
import type {
  PluginFolder,
  PluginNote,
  PluginNotesPage,
  PluginNotesScope,
  PluginVault
} from 'hebra-plugin-api';
import {
  inboxFolders,
  buildIndex,
  relativeTo,
  type AuditInput,
  type IdEntry,
  type IndexInput,
  type JdIndex,
  type NoteMeta
} from './engine';
import {
  jdexFrontmatterString,
  readJdexFrontmatter,
  type JdexFrontmatterMarkdown
} from './frontmatter';

/** Same filename stem rules as Hebra's sanitizeNoteFileStem; never let a title
 * introduce a pseudo-directory into the pure engine's paths. */
export function jdexNoteFileStem(title: string): string {
  // eslint-disable-next-line no-control-regex -- matches Hebra's filename sanitizer.
  let cleaned = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '–').replace(/[ .]+$/gu, '').trim();
  if (!cleaned) cleaned = 'Nota sin título';
  if (cleaned.startsWith('.')) cleaned = `_${cleaned}`;
  // Hebra reserves 34 characters for the collision suffix and 3 for `.md`.
  let stem = '';
  let bytes = 0;
  for (const point of cleaned) {
    const size = new TextEncoder().encode(point).length;
    if (bytes + size > 218 || stem.length + point.length > 218) break;
    stem += point;
    bytes += size;
  }
  return stem;
}

const NOTES_PAGE_SIZE = 200;

/** Tope de ids por `noteSummary` (el del almacén de Hebra, `NOTE_SUMMARY_MAX_IDS`): más
 *  que esto no se resuelve por ids sino reconstruyendo. */
export const NOTE_SUMMARY_MAX_IDS = 200;

export interface JdexLibraryPort {
  notesPage(
    cursor: string | null,
    limit: number,
    scope?: PluginNotesScope
  ): Promise<PluginNotesPage>;
  noteRead(id: string): Promise<PluginNote | null>;
}

/**
 * Ruta completa de cada carpeta VIVA, con el nombre real (mayúsculas incluidas, sin
 * pasar por `folderPathSegments` de `folder-tree.ts`, que las pone en minúsculas para
 * comparar y aquí rompería el prefijo `21 Productos…` que el motor necesita legible) y
 * normalizada a NFC. `foldersList()` ya da el padre EFECTIVO (`folder-tree.ts` §3): un
 * ciclo llegado por sync no cuelga esto. `rootFolderId` es `api.vault.rootFolderId()`.
 */
export function jdexFolderPaths(
  folders: readonly PluginFolder[],
  rootFolderId: string
): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const cache = new Map<string, string>([[rootFolderId, '']]);
  const visiting = new Set<string>();
  function pathOf(id: string): string {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return ''; // ciclo ya roto por foldersList(); nunca debería pasar.
    visiting.add(id);
    const folder = byId.get(id);
    const path = folder
      ? (() => {
          const parentPath = folder.parentId === null ? '' : pathOf(folder.parentId);
          const name = folder.name.normalize('NFC');
          return parentPath ? `${parentPath}/${name}` : name;
        })()
      : '';
    visiting.delete(id);
    cache.set(id, path);
    return path;
  }
  const result = new Map<string, string>();
  for (const folder of folders) result.set(folder.id, pathOf(folder.id));
  return result;
}

/** El id de la carpeta viva cuya ruta completa es exactamente `path` (o la raíz para
 *  `''`), o `null` sin ninguna. */
export function jdexResolveFolderId(
  walk: Pick<JdexLibraryWalk, 'folderPaths' | 'rootFolderId'>,
  path: string
): string | null {
  if (path === '') return walk.rootFolderId;
  for (const [id, candidate] of walk.folderPaths) {
    if (candidate === path) return id;
  }
  return null;
}

export interface JdexNoteRef {
  readonly id: string;
  readonly folderId: string;
  readonly title: string;
  /** Ruta completa con `.md`, como la vería el motor. */
  readonly path: string;
}

/** Notas DIRECTAS de `folderId` (nunca subcarpetas: cada carpeta se recorre una vez en
 *  `walkJdexLibrary`), con su ruta completa. Pagina hasta agotar el cursor. */
async function directNotesOf(
  library: Pick<JdexLibraryPort, 'notesPage'>,
  folderId: string,
  folderPath: string
): Promise<JdexNoteRef[]> {
  const out: JdexNoteRef[] = [];
  let cursor: string | null = null;
  do {
    const page = await library.notesPage(cursor, NOTES_PAGE_SIZE, { kind: 'folder', folderId });
    for (const item of page.items) {
      const title = item.title.normalize('NFC');
      out.push({
        id: item.id,
        folderId,
        title,
        path: folderPath ? `${folderPath}/${jdexNoteFileStem(title)}.md` : `${jdexNoteFileStem(title)}.md`
      });
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return out;
}

export interface JdexLibraryWalk {
  /** Id de la carpeta raíz de la biblioteca (`api.vault.rootFolderId()`). */
  readonly rootFolderId: string;
  /** Ruta de cada carpeta VIVA, id → ruta. */
  readonly folderPaths: ReadonlyMap<string, string>;
  /** Rutas de las carpetas bajo `systemRoot` (para `IndexInput.folderPaths`). */
  readonly systemFolderPaths: readonly string[];
  /** Notas directas de cada carpeta bajo `systemRoot`, raíz de la biblioteca incluida. */
  readonly systemNotes: readonly JdexNoteRef[];
}

/** Live number check immediately before creating: all folders and just the JDex
 * note titles, so it does not load every body or rely on an open dialog's snapshot. */
export async function readJdexCreationIndex(
  library: Pick<PluginVault, 'foldersList' | 'rootFolderId' | 'notesPage'>,
  settings: { systemRoot: string; jdexFolder: string }
): Promise<JdIndex> {
  const rootFolderId = library.rootFolderId();
  const paths = jdexFolderPaths(await library.foldersList(), rootFolderId);
  const folderId = jdexResolveFolderId({ rootFolderId, folderPaths: paths }, settings.jdexFolder);
  if (!settings.jdexFolder || folderId === null) throw new Error('La carpeta JDex ya no existe.');
  const notes = await directNotesOf(library, folderId, settings.jdexFolder);
  return buildIndex({ systemRoot: settings.systemRoot, jdexFolder: settings.jdexFolder,
    folderPaths: [...paths.values()], notePaths: notes.map((note) => note.path) });
}

/**
 * Recorre la biblioteca bajo `systemRoot` (vacío = toda la biblioteca): una consulta por
 * carpeta viva, nunca por nota. Es la única función de este fichero que habla con la
 * biblioteca; el resto son puras sobre lo que esta devuelve.
 */
export async function walkJdexLibrary(
  library: JdexLibraryPort,
  allFolders: readonly PluginFolder[],
  systemRoot: string,
  rootFolderId: string
): Promise<JdexLibraryWalk> {
  // La raíz de la biblioteca no es una carpeta más (Hebra no la lista; el host falso de
  // la API sí): se recorre aparte, así que nunca entra dos veces.
  const folders = allFolders.filter((folder) => folder.id !== rootFolderId);
  const folderPaths = jdexFolderPaths(folders, rootFolderId);
  const underRoot = folders.filter(
    (folder) => relativeTo(systemRoot, folderPaths.get(folder.id) ?? '') !== null
  );
  const systemFolderPaths = underRoot.map((folder) => folderPaths.get(folder.id)!);
  const systemNotes: JdexNoteRef[] = [];
  // Solo si la raíz de la biblioteca cae bajo `systemRoot`.
  if (relativeTo(systemRoot, '') !== null) {
    systemNotes.push(...(await directNotesOf(library, rootFolderId, '')));
  }
  for (const folder of underRoot) {
    systemNotes.push(...(await directNotesOf(library, folder.id, folderPaths.get(folder.id)!)));
  }
  return { rootFolderId, folderPaths, systemFolderPaths, systemNotes: sortJdexNotes(systemNotes) };
}

/** Orden CANÓNICO de las notas del sistema (ruta, después id): el recorrido completo y la
 *  actualización incremental dan el mismo `walk`, sin depender del orden de las páginas
 *  (que cambia con cada guardado: más recientes arriba). */
export function sortJdexNotes(notes: readonly JdexNoteRef[]): JdexNoteRef[] {
  return [...notes].sort((left, right) =>
    left.path === right.path
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : left.path < right.path
        ? -1
        : 1
  );
}

/** `IndexInput` del motor a partir de un recorrido ya hecho: `buildIndex` filtra por su
 *  cuenta las notas que no sean directas de `jdexFolder`, así que aquí van todas. */
export function buildJdexIndexInput(
  walk: JdexLibraryWalk,
  settings: { systemRoot: string; jdexFolder: string }
): IndexInput {
  return {
    systemRoot: settings.systemRoot,
    folderPaths: [...walk.systemFolderPaths],
    jdexFolder: settings.jdexFolder,
    notePaths: walk.systemNotes.map((note) => note.path)
  };
}

/**
 * `NoteMeta[]` del motor: solo las notas DIRECTAS de `jdexFolder` (contrato del 28 sep
 * 2026, punto 1 — el frontmatter parseado que emula Obsidian solo se lee ahí). `body`
 * solo viaja cuando falta `descripcion` (el motor solo lo usa para proponerla,
 * `firstSentence`): con ~1 nota JDex por ID, no por las ~3.300 de la biblioteca, pero
 * cargar los cuerpos de las que SÍ tienen descripción sería trabajo de sobra.
 */
export async function buildJdexAuditNotes(
  library: Pick<JdexLibraryPort, 'noteRead'>,
  markdown: JdexFrontmatterMarkdown,
  walk: JdexLibraryWalk,
  jdexFolder: string
): Promise<NoteMeta[]> {
  return jdexAuditNotes(
    walk,
    await loadJdexAuditEntries(library, markdown, walk, jdexFolder),
    jdexFolder
  );
}

/** Lo que JDex lee de CADA nota de la carpeta JDex (frontmatter y, solo si falta
 *  `descripcion`, el cuerpo), con el SHA-256 del cuerpo del que salió: dice, sin releerla,
 *  si la nota sigue igual. La ruta NO va aquí: sale de dónde está la nota ahora. */
export interface JdexAuditEntry {
  readonly sha: string;
  readonly frontmatter: NoteMeta['frontmatter'];
  readonly body: string | undefined;
}

function jdexAuditEntryOf(row: PluginNote, markdown: JdexFrontmatterMarkdown): JdexAuditEntry {
  // Una nota protegida llega sin cuerpo: no aporta frontmatter ni texto para proponer.
  if (row.body === null) {
    return { sha: row.revision.bodySha256, frontmatter: null, body: undefined };
  }
  const frontmatter = readJdexFrontmatter(row.body, markdown);
  const hasDescription = jdexFrontmatterString(frontmatter, 'descripcion') !== '';
  return {
    sha: row.revision.bodySha256,
    frontmatter,
    body: hasDescription ? undefined : row.body
  };
}

/** El id de la carpeta JDex dentro del recorrido, o `null` sin ajuste o sin carpeta. */
function jdexFolderIdOf(walk: JdexLibraryWalk, jdexFolder: string): string | null {
  return jdexFolder === '' ? null : jdexResolveFolderId(walk, jdexFolder);
}

/** Lee (`noteRead`, con cuerpo) cada nota directa de la carpeta JDex. */
export async function loadJdexAuditEntries(
  library: Pick<JdexLibraryPort, 'noteRead'>,
  markdown: JdexFrontmatterMarkdown,
  walk: JdexLibraryWalk,
  jdexFolder: string
): Promise<Map<string, JdexAuditEntry>> {
  const entries = new Map<string, JdexAuditEntry>();
  const jdexFolderId = jdexFolderIdOf(walk, jdexFolder);
  if (jdexFolderId === null) return entries;
  for (const ref of walk.systemNotes) {
    if (ref.folderId !== jdexFolderId) continue;
    const row = await library.noteRead(ref.id);
    if (!row) continue; // purgada entre medias: no cuenta.
    entries.set(ref.id, jdexAuditEntryOf(row, markdown));
  }
  return entries;
}

/** `NoteMeta[]` a partir de lo ya leído: en el orden canónico del recorrido y con la ruta
 *  de DÓNDE ESTÁ la nota ahora (un cambio de título no obliga a releerla). */
export function jdexAuditNotes(
  walk: JdexLibraryWalk,
  entries: ReadonlyMap<string, JdexAuditEntry>,
  jdexFolder: string
): NoteMeta[] {
  const jdexFolderId = jdexFolderIdOf(walk, jdexFolder);
  if (jdexFolderId === null) return [];
  const out: NoteMeta[] = [];
  for (const ref of walk.systemNotes) {
    if (ref.folderId !== jdexFolderId) continue;
    const entry = entries.get(ref.id);
    if (!entry) continue;
    out.push({ path: ref.path, frontmatter: entry.frontmatter, body: entry.body });
  }
  return out;
}

/** Lo que el módulo conserva entre cambios: el recorrido y lo leído de la carpeta JDex. */
export interface JdexNotesState {
  readonly walk: JdexLibraryWalk;
  readonly entries: ReadonlyMap<string, JdexAuditEntry>;
}

export type JdexNotesUpdate =
  /** Ninguna de las notas cambió en nada que JDex indexe. */
  | { kind: 'unchanged' }
  | { kind: 'updated'; state: JdexNotesState }
  /** No se puede resolver por ids: reconstrucción completa. */
  | { kind: 'rebuild'; reason: 'too-many-ids' | 'unknown-folder' };

/**
 * Pone al día el recorrido y las entradas de la carpeta JDex tras un cambio en estas
 * notas, SIN volver a recorrer la biblioteca: una `noteSummary` (sin cuerpo) y, solo para
 * una nota de la carpeta JDex, su `noteRead`. Con la API 1.1 el resumen trae `bodySha256`:
 * si coincide con el SHA de la entrada ya indexada no se lee nada. Con un host 1.0.0 el
 * campo no llega (se comprueba en tiempo de ejecución, no por tipo), así que entonces, o si
 * el SHA difiere o no hay entrada conocida, se lee; la entrada solo se sustituye (y solo
 * cuenta como cambio) si el SHA cambió.
 *
 * Qué indexa JDex de cada nota, y por tanto qué se mira:
 *  - pertenencia: viva (ni papelera ni archivo) y en una carpeta bajo `systemRoot`;
 *  - título y carpeta efectiva (dan la ruta `carpeta/título.md`);
 *  - solo en la carpeta JDex: el frontmatter y, si falta `descripcion`, el cuerpo.
 * Todo lo demás (cuerpo de otra nota, ancladas, ocultas, etiquetas) no entra, y por eso un
 * guardado de cuerpo fuera de la carpeta JDex no cambia nada.
 *
 * El resultado es IGUAL al de un recorrido completo sobre el mismo estado (lo comprueba
 * `library-index.test.ts` contra el vault de la API). Una carpeta que el recorrido no conoce
 * (creada tras él) no se puede ubicar por ids: pide reconstruir.
 */
export async function applyJdexNoteChanges(
  library: Pick<PluginVault, 'noteSummary' | 'noteRead'>,
  markdown: JdexFrontmatterMarkdown,
  state: JdexNotesState,
  ids: readonly string[],
  settings: { systemRoot: string; jdexFolder: string }
): Promise<JdexNotesUpdate> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { kind: 'unchanged' };
  if (unique.length > NOTE_SUMMARY_MAX_IDS) return { kind: 'rebuild', reason: 'too-many-ids' };
  const { walk } = state;
  const summaries = new Map((await library.noteSummary(unique)).map((item) => [item.id, item]));
  const jdexFolderId = jdexFolderIdOf(walk, settings.jdexFolder);
  const notes = new Map(walk.systemNotes.map((note) => [note.id, note]));
  const entries = new Map(state.entries);
  let changed = false;
  for (const id of unique) {
    const summary = summaries.get(id);
    let next: JdexNoteRef | null = null;
    if (summary && summary.trashedAt === null && summary.archivedAt === null) {
      const folderId = summary.folderId;
      const folderPath = folderId === walk.rootFolderId ? '' : walk.folderPaths.get(folderId);
      if (folderPath === undefined) return { kind: 'rebuild', reason: 'unknown-folder' };
      if (relativeTo(settings.systemRoot, folderPath) !== null) {
        const title = summary.title.normalize('NFC');
        next = {
          id,
          folderId,
          title,
          path: folderPath ? `${folderPath}/${jdexNoteFileStem(title)}.md` : `${jdexNoteFileStem(title)}.md`
        };
      }
    }
    const previous = notes.get(id);
    if (next === null) {
      if (previous) {
        notes.delete(id);
        changed = true;
      }
    } else if (
      !previous ||
      previous.folderId !== next.folderId ||
      previous.title !== next.title ||
      previous.path !== next.path
    ) {
      notes.set(id, next);
      changed = true;
    }
    // La carpeta JDex es la única de la que se lee algo más que el título.
    if (next !== null && next.folderId === jdexFolderId) {
      const known = entries.get(id);
      // Host 1.0.0: el resumen no trae `bodySha256`; el tipo (1.1) lo da por presente.
      const summarySha = (summary as { bodySha256?: unknown }).bodySha256;
      if (known && typeof summarySha === 'string' && summarySha === known.sha) continue;
      const row = await library.noteRead(id);
      if (!row) {
        if (entries.delete(id)) changed = true; // purgada entre medias: no cuenta.
      } else if (!known || known.sha !== row.revision.bodySha256) {
        entries.set(id, jdexAuditEntryOf(row, markdown));
        changed = true;
      }
    } else if (entries.delete(id)) {
      changed = true;
    }
  }
  if (!changed) return { kind: 'unchanged' };
  return {
    kind: 'updated',
    state: { walk: { ...walk, systemNotes: sortJdexNotes([...notes.values()]) }, entries }
  };
}

/** `AuditInput` del motor: `filePaths` es toda nota bajo `systemRoot` (las notas SON el
 *  contenido en Hebra; los adjuntos de la biblioteca, `FileRow`, quedan fuera de este
 *  lote — lo dice el informe). Sin patrón de subcarpetas (fuera de alcance del lote 1). */
export function buildJdexAuditInput(
  index: JdIndex,
  notes: readonly NoteMeta[],
  walk: JdexLibraryWalk,
  options: {
    noteWithoutFolderIsFinding: boolean;
    descriptionIsFinding: boolean;
    structureNotesAreFindings: boolean;
  }
): AuditInput {
  return {
    index,
    notes: [...notes],
    filePaths: walk.systemNotes.map((note) => note.path),
    folderPaths: [...walk.systemFolderPaths],
    options
  };
}

export interface JdexInboxEntry {
  readonly entry: IdEntry;
  readonly path: string;
  readonly folderId: string | null;
  readonly count: number;
}

export interface JdexInboxSummary {
  readonly folders: readonly JdexInboxEntry[];
  readonly total: number;
}

/** «Inbox: N» (tarea 4 del lote): recuento de notas directas de cada carpeta `.01` del
 *  índice, sin volver a preguntar a la biblioteca (usa lo que `walkJdexLibrary` ya trajo).
 *  Los adjuntos quedan fuera, mismo límite que `buildJdexAuditInput`. */
export function buildJdexInboxSummary(index: JdIndex, walk: JdexLibraryWalk): JdexInboxSummary {
  const folders: JdexInboxEntry[] = inboxFolders(index)
    .filter((entry): entry is IdEntry & { folderPath: string } => entry.folderPath !== undefined)
    .map((entry) => {
      const folderId = jdexResolveFolderId(walk, entry.folderPath);
      const count =
        folderId === null
          ? 0
          : walk.systemNotes.filter((note) => note.folderId === folderId).length;
      return { entry, path: entry.folderPath, folderId, count };
    });
  return { folders, total: folders.reduce((sum, f) => sum + f.count, 0) };
}

/** El primer inbox con elementos (orden del índice, que ya es por id); `null` si todos
 *  están vacíos o no hay ninguno. «Pulsarlo abre la carpeta del primer inbox con
 *  elementos» (tarea 4). */
export function firstNonEmptyJdexInbox(summary: JdexInboxSummary): JdexInboxEntry | null {
  return summary.folders.find((f) => f.count > 0) ?? summary.folders[0] ?? null;
}

/** Ruta completa de la nota activa, TAL COMO la construye este adaptador (para
 *  `locate()`, tarea 2): folder de la nota + su título + `.md`. `null` sin carpeta
 *  conocida (una nota cuya carpeta ya no está en `folderPaths`, caso raro). */
export function jdexNotePath(
  folderPaths: ReadonlyMap<string, string>,
  note: { folderId: string; title: string }
): string | null {
  const folderPath = folderPaths.get(note.folderId);
  if (folderPath === undefined) return null;
  const title = note.title.normalize('NFC');
  return folderPath ? `${folderPath}/${jdexNoteFileStem(title)}.md` : `${jdexNoteFileStem(title)}.md`;
}
