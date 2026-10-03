/**
 * Dobles de prueba del plugin de Hebra. Tres piezas, todas sobre los TIPOS de
 * `hebra-plugin-api` (lo único que el plugin ve de Hebra):
 *
 * - `FakeJdexVault`: un `PluginVault` en memoria CON jerarquía de carpetas, `noteMove`,
 *   `folderRename`/`folderMove`, `noteSummary` y paginado por carpeta. Sustituye a
 *   `fake-jdex-write-library.ts` de Hebra (que doblaba el `LibraryStorePort`); el host
 *   falso del paquete (`createFakePluginApi`) solo tiene notas en la raíz y no modela nada
 *   de esto. Donde la prueba solo necesita notas en la raíz se usa `createFakePluginApi`
 *   a secas (`jdex-write.test.ts`).
 * - `createJdexTestApi`: un `HebraPluginApi` completo = el host falso del paquete + el
 *   vault de arriba + un `workspace` que se puede disparar a mano + un `ui` que monta de
 *   verdad los diálogos y avisos en el DOM (el host falso ignora `openModal`) + un
 *   `markdown.setProperty` de doble (el del host falso lanza «no implementado»).
 * - `fakeSetProperty`: LA parte que no es de este repo. El escritor de propiedades de
 *   verdad es el de Hebra (`setMarkdownProperty`, conserva el frontmatter byte a byte);
 *   aquí solo se imita su formato (`clave: "valor"`, JSON) para que las pruebas del
 *   adaptador vean el cuerpo que llegaría a Hebra.
 */
import { vi } from 'vitest';
import type {
  HebraPluginApi,
  PluginActiveNote,
  PluginCapability,
  PluginFile,
  PluginFilesPage,
  PluginFolder,
  PluginFolderRenameEvent,
  PluginFolderRenameGuard,
  PluginMarkdown,
  PluginModalHandle,
  PluginNote,
  PluginNoteListItem,
  PluginNoteRewrite,
  PluginNoteSaveResult,
  PluginNoteSummary,
  PluginNoteTitleRenamedEvent,
  PluginNotesChange,
  PluginNotesPage,
  PluginNotesRewriteResult,
  PluginNotesScope,
  PluginUi,
  PluginUnregister,
  PluginVault,
  PluginWorkspace
} from 'hebra-plugin-api';
import { createFakePluginApi, FAKE_ROOT_FOLDER_ID, type FakePluginApi } from 'hebra-plugin-api/testing';

export { FAKE_ROOT_FOLDER_ID };

// ---- títulos y notas ----

/** `title:` del frontmatter o, si no hay, el primer `# …` (la regla de `PluginVault`). */
export function titleOf(body: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(body);
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/u)) {
      const match = /^title:\s*(.*)$/u.exec(line);
      if (!match) continue;
      const raw = match[1].trim();
      try {
        const parsed: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw;
        if (typeof parsed === 'string' && parsed.trim() !== '') return parsed.trim();
      } catch {
        // Comillas rotas: se ignora, como un `title:` vacío.
      }
    }
  }
  const rest = frontmatter ? body.slice(frontmatter[0].length) : body;
  return /^#[ \t]+(.+?)[ \t#]*$/mu.exec(rest)?.[1]?.trim() ?? '';
}

/** Una nota lista para `seedNote`: el título se deriva del cuerpo, como en Hebra. */
export function fakeNote(
  id: string,
  folderId: string,
  body: string,
  overrides: Partial<PluginNote> = {}
): PluginNote {
  return {
    id,
    folderId,
    title: titleOf(body),
    body,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    favorite: false,
    trashedAt: null,
    archivedAt: null,
    revision: { localSeq: 1, bodySha256: `sha-${id}` },
    ...overrides
  };
}

/** Un `PluginFolder` mínimo. */
export function fakeFolder(id: string, parentId: string | null, name: string): PluginFolder {
  return { id, parentId, name, createdAt: 0, updatedAt: 0 };
}

// ---- el vault ----

function notImplemented(what: string): never {
  throw new Error(`FakeJdexVault: «${what}» no está en el doble.`);
}

export class FakeJdexVault implements PluginVault {
  readonly #notes = new Map<string, PluginNote>();
  readonly #folders = new Map<string, PluginFolder>();
  #noteSeq = 0;
  #folderSeq = 0;
  /** Cada `notesRewriteBatch` recibido, para comprobar `cause` y las revisiones. */
  readonly rewriteCalls: {
    entries: PluginNoteRewrite[];
    options: { cause?: string | null; touchUpdatedAt?: boolean } | undefined;
  }[] = [];

  libraryId(): string {
    return 'lib-1';
  }

  rootFolderId(): string {
    return FAKE_ROOT_FOLDER_ID;
  }

  seedNote(note: PluginNote): void {
    this.#notes.set(note.id, { ...note, revision: { ...note.revision } });
  }

  seedFolder(folder: PluginFolder): void {
    this.#folders.set(folder.id, { ...folder });
  }

  // Lo que el plugin no puede hacer con la API pero la biblioteca real sí (otro
  // dispositivo, otra parte de Hebra): sirve para comprobar que el índice por ids se
  // pone al día igual que una reconstrucción completa.

  /** Un guardado «desde fuera»: nueva revisión, nuevo SHA, título derivado del cuerpo. */
  saveElsewhere(id: string, body: string): void {
    const current = this.#require(id);
    this.#notes.set(id, this.#rewritten(current, body));
  }

  setTrashed(id: string, trashed: boolean): void {
    const current = this.#require(id);
    this.#notes.set(id, { ...current, trashedAt: trashed ? 9 : null });
  }

  setArchived(id: string, archived: boolean): void {
    const current = this.#require(id);
    this.#notes.set(id, { ...current, archivedAt: archived ? 9 : null });
  }

  setFavorite(id: string, favorite: boolean): void {
    this.#notes.set(id, { ...this.#require(id), favorite });
  }

  /** Una nota protegida: se lee como `{ locked: true, body: null }`, sin texto. Proteger
   *  una nota la reescribe (el envoltorio cifrado), así que cambia la revisión. */
  setLocked(id: string, locked: boolean): void {
    const current = this.#require(id);
    const localSeq = current.revision.localSeq + 1;
    this.#notes.set(id, {
      ...current,
      locked,
      revision: { localSeq, bodySha256: `sha-${id}-${locked ? "locked" : "open"}-${localSeq}` }
    });
  }

  /** Baja definitiva: la nota deja de existir. */
  purge(id: string): void {
    this.#notes.delete(id);
  }

  #require(id: string): PluginNote {
    const note = this.#notes.get(id);
    if (!note) throw new Error(`FakeJdexVault: nota no encontrada (${id}).`);
    return note;
  }

  #rewritten(current: PluginNote, body: string): PluginNote {
    const derived = titleOf(body);
    // Reescribir conserva solo un título que no salía del cuerpo cuando el nuevo no da
    // ninguno (la regla de `PluginVault`).
    const title =
      derived === '' && titleOf(current.body ?? '') === '' ? current.title : derived;
    const localSeq = current.revision.localSeq + 1;
    return {
      ...current,
      body,
      title,
      updatedAt: current.updatedAt + 1,
      revision: { localSeq, bodySha256: `sha-${current.id}-${localSeq}` }
    };
  }

  #clone(note: PluginNote): PluginNote {
    return { ...note, revision: { ...note.revision } };
  }

  async noteCreate(input: { folderId: string | null; body: string }): Promise<PluginNote> {
    this.#noteSeq += 1;
    const id = `fake-note-${this.#noteSeq}`;
    const note = fakeNote(id, input.folderId ?? this.rootFolderId(), input.body, {
      createdAt: this.#noteSeq,
      updatedAt: this.#noteSeq,
      revision: { localSeq: 1, bodySha256: `sha-${id}-1` }
    });
    this.#notes.set(id, note);
    return this.#clone(note);
  }

  async noteRead(id: string): Promise<PluginNote | null> {
    const note = this.#notes.get(id);
    if (!note) return null;
    return { ...this.#clone(note), body: note.locked ? null : note.body };
  }

  async noteSave(): Promise<PluginNoteSaveResult> {
    return notImplemented('noteSave');
  }

  async notesRewriteBatch(
    entries: readonly PluginNoteRewrite[],
    options?: { cause?: string | null; touchUpdatedAt?: boolean }
  ): Promise<PluginNotesRewriteResult> {
    this.rewriteCalls.push({ entries: entries.map((entry) => ({ ...entry })), options });
    const written: string[] = [];
    const stale: string[] = [];
    for (const entry of entries) {
      const current = this.#notes.get(entry.id);
      if (!current || current.revision.localSeq !== entry.expected.localSeq) {
        stale.push(entry.id);
        continue;
      }
      this.#notes.set(entry.id, this.#rewritten(current, entry.body));
      written.push(entry.id);
    }
    return { written, stale };
  }

  async noteMove(id: string, folderId: string): Promise<PluginNote> {
    const current = this.#require(id);
    const next = { ...current, folderId, updatedAt: current.updatedAt + 1 };
    this.#notes.set(id, next);
    return this.#clone(next);
  }

  async noteTrash(id: string): Promise<PluginNote> {
    this.setTrashed(id, true);
    return this.#clone(this.#require(id));
  }

  async noteSummary(ids: readonly string[]): Promise<PluginNoteSummary[]> {
    return ids.flatMap((id) => {
      const note = this.#notes.get(id);
      return note
        ? [
            {
              id: note.id,
              title: note.title,
              excerpt: '',
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              favorite: note.favorite,
              locked: note.locked,
              folderId: note.folderId,
              trashedAt: note.trashedAt,
              archivedAt: note.archivedAt
            }
          ]
        : [];
    });
  }

  /** Solo el ámbito de carpeta (lo único que pide `walkJdexLibrary`): las notas vivas y
   *  directas de esa carpeta, paginadas, en el orden de inserción. */
  async notesPage(
    cursor: string | null,
    limit: number,
    scope?: PluginNotesScope
  ): Promise<PluginNotesPage> {
    if (!scope || scope.kind !== 'folder') {
      throw new Error('FakeJdexVault: solo ámbito de carpeta.');
    }
    const notes = [...this.#notes.values()].filter(
      (note) => note.folderId === scope.folderId && note.trashedAt === null && note.archivedAt === null
    );
    const start = cursor ? notes.findIndex((note) => note.id === cursor) + 1 : 0;
    const page = notes.slice(start, start + limit);
    const items: PluginNoteListItem[] = page.map((note) => ({
      id: note.id,
      title: note.title,
      excerpt: '',
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      favorite: note.favorite,
      locked: note.locked
    }));
    return {
      items,
      nextCursor: start + limit < notes.length ? page[page.length - 1].id : null
    };
  }

  async foldersList(): Promise<PluginFolder[]> {
    return [...this.#folders.values()].map((folder) => ({ ...folder }));
  }

  async folderCreate(parentId: string | null, name: string): Promise<PluginFolder> {
    this.#folderSeq += 1;
    const folder = fakeFolder(`fake-folder-${this.#folderSeq}`, parentId, name);
    this.#folders.set(folder.id, folder);
    return { ...folder };
  }

  /** «Retirar un ID»: renombrar con la fecha delante y mover a la `.09` son dos
   *  escrituras de carpeta separadas, como en la biblioteca real. */
  async folderRename(id: string, name: string): Promise<PluginFolder> {
    const current = this.#folders.get(id);
    if (!current) throw new Error(`FakeJdexVault: carpeta no encontrada (${id}).`);
    const next = { ...current, name, updatedAt: current.updatedAt + 1 };
    this.#folders.set(id, next);
    return { ...next };
  }

  async folderMove(id: string, parentId: string | null): Promise<PluginFolder> {
    const current = this.#folders.get(id);
    if (!current) throw new Error(`FakeJdexVault: carpeta no encontrada (${id}).`);
    const next = { ...current, parentId, updatedAt: current.updatedAt + 1 };
    this.#folders.set(id, next);
    return { ...next };
  }

  /** Esta biblioteca de pruebas no modela ficheros (adjuntos), solo notas. */
  async filesPage(): Promise<PluginFilesPage> {
    return { items: [], nextCursor: null };
  }

  async fileRead(): Promise<PluginFile | null> {
    return notImplemented('fileRead');
  }

  async fileCreate(): Promise<PluginFile> {
    return notImplemented('fileCreate');
  }

  async fileReplace(): Promise<PluginFile> {
    return notImplemented('fileReplace');
  }

  async fileTrash(): Promise<PluginFile> {
    return notImplemented('fileTrash');
  }

  async blobRead(): Promise<Uint8Array | null> {
    return notImplemented('blobRead');
  }

  async blobPut(): Promise<{ sha256: string; byteLength: number; alreadyPresent: boolean }> {
    return notImplemented('blobPut');
  }

  onChange(): PluginUnregister {
    return () => {};
  }
}

// ---- markdown ----

/** El `markdown` del host falso: `frontmatterRange` y `withTitle` son aproximaciones del de Hebra. */
const MARKDOWN: PluginMarkdown = createFakePluginApi().api.markdown;

/**
 * Doble de `api.markdown.setProperty` (ver la cabecera): `clave: "valor"` en JSON, la línea
 * existente sustituida (o quitada con `null`) o una línea nueva antes del cierre del
 * frontmatter, que se crea si no hay. No imita los casos «no parcheable» de Hebra.
 */
export function fakeSetProperty(
  body: string,
  key: string,
  value: string | readonly string[] | null
): string {
  const range = MARKDOWN.frontmatterRange(body);
  const line = value === null ? null : `${key}: ${JSON.stringify(value)}`;
  if (!range) {
    return line === null ? body : `---\n${line}\n---\n${body}`;
  }
  const block = body.slice(0, range.end);
  const rest = body.slice(range.end);
  const lines = block.split('\n');
  const existing = lines.findIndex((entry) => new RegExp(`^${key}\\s*:`, 'u').test(entry));
  if (existing >= 0) {
    if (line === null) lines.splice(existing, 1);
    else lines[existing] = line;
  } else if (line !== null) {
    // Antes del delimitador de cierre: la última línea con contenido del bloque.
    const closing = block.endsWith('\n') ? lines.length - 2 : lines.length - 1;
    lines.splice(closing, 0, line);
  }
  return lines.join('\n') + rest;
}

// ---- workspace ----

/** `workspace` que el test dispara a mano (como Hebra al abrir una nota, cambiar carpetas…). */
export class FakeWorkspace {
  active: PluginActiveNote | null = null;
  readonly openNote = vi.fn<(id: string) => void>();
  readonly selectFolder = vi.fn<(id: string) => void>();
  readonly openSearch = vi.fn<(query: string) => void>();
  readonly #activeListeners = new Set<(note: PluginActiveNote | null) => void>();
  readonly #foldersListeners = new Set<(folders: readonly PluginFolder[]) => void>();
  readonly #notesListeners = new Set<(change: PluginNotesChange) => void>();
  readonly #titleListeners = new Set<(event: PluginNoteTitleRenamedEvent) => void>();
  readonly #guards = new Set<PluginFolderRenameGuard>();

  readonly api: PluginWorkspace = {
    activeNote: () => this.active,
    onActiveNoteChange: (listener) => this.#subscribe(this.#activeListeners, listener),
    openNote: (id) => this.openNote(id),
    selectFolder: (id) => this.selectFolder(id),
    openSearch: (query) => this.openSearch(query),
    onFoldersChange: (listener) => this.#subscribe(this.#foldersListeners, listener),
    onNotesChange: (listener) => this.#subscribe(this.#notesListeners, listener),
    onBeforeFolderRename: (guard) => this.#subscribe(this.#guards, guard),
    onNoteTitleRenamed: (listener) => this.#subscribe(this.#titleListeners, listener),
    restart: async () => true
  };

  #subscribe<T>(set: Set<T>, listener: T): PluginUnregister {
    set.add(listener);
    return () => void set.delete(listener);
  }

  setActiveNote(note: PluginActiveNote | null): void {
    this.active = note;
    for (const listener of [...this.#activeListeners]) listener(note);
  }

  emitFolders(folders: readonly PluginFolder[]): void {
    for (const listener of [...this.#foldersListeners]) listener(folders);
  }

  emitNotes(change: PluginNotesChange): void {
    for (const listener of [...this.#notesListeners]) listener(change);
  }

  emitTitleRenamed(event: PluginNoteTitleRenamedEvent): void {
    for (const listener of [...this.#titleListeners]) listener(event);
  }

  /** Como Hebra antes de `folderRename`/`folderMove`: se pregunta a las guardias en orden y
   *  basta un `false`. */
  async askFolderRename(event: PluginFolderRenameEvent): Promise<boolean> {
    for (const guard of [...this.#guards]) {
      if (!(await guard(event))) return false;
    }
    return true;
  }

  get guardCount(): number {
    return this.#guards.size;
  }
}

// ---- ui con DOM ----

/** Los diálogos y avisos que el host falso del paquete ignora, montados de verdad con las
 *  clases de Hebra (`hebra-module-modal`, `hebra-module-notice`). */
function domUi(base: PluginUi): PluginUi {
  return {
    ...base,
    openModal(mount, options): PluginModalHandle {
      const dialog = document.createElement('dialog');
      dialog.className = 'hebra-module-modal';
      document.body.append(dialog);
      const cleanup = mount(dialog);
      let closed = false;
      return {
        close() {
          if (closed) return;
          closed = true;
          if (typeof cleanup === 'function') cleanup();
          dialog.remove();
          options?.onClosed?.();
        }
      };
    },
    notice(text, onClick) {
      base.notice(text, onClick);
      const notice = document.createElement('div');
      notice.className = 'hebra-module-notice';
      if (onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => onClick());
        notice.append(button);
      } else {
        notice.textContent = text;
      }
      document.body.append(notice);
    }
  };
}

// ---- la API completa ----

export interface JdexTestApiOptions {
  vault?: PluginVault;
  /** Ajustes ya guardados (`storage.settings.save`) antes de activar. */
  settings?: unknown;
  isoDates?: boolean;
  /** Las capacidades declaradas (por defecto, las del `hebra.json`). */
  capabilities?: readonly PluginCapability[];
}

export interface JdexTestApi {
  api: HebraPluginApi;
  fake: FakePluginApi;
  vault: PluginVault;
  workspace: FakeWorkspace;
}

export async function createJdexTestApi(options: JdexTestApiOptions = {}): Promise<JdexTestApi> {
  const fake = createFakePluginApi({
    capabilities: options.capabilities ?? ['vault.read', 'vault.write', 'editor'],
    ...(options.isoDates !== undefined ? { isoDates: options.isoDates } : {})
  });
  const workspace = new FakeWorkspace();
  const vault = options.vault ?? new FakeJdexVault();
  const markdown: PluginMarkdown = { ...fake.api.markdown, setProperty: fakeSetProperty };
  const api: HebraPluginApi = {
    ...fake.api,
    ui: domUi(fake.api.ui),
    vault,
    workspace: workspace.api,
    markdown
  };
  if (options.settings !== undefined) await api.storage.settings.save(options.settings);
  return { api, fake, vault, workspace };
}
