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
 *   aquí va su port fiel (`src/vault/frontmatter-lines.ts`), medido contra el host, para que las
 *   pruebas del adaptador vean el cuerpo que llegaría a Hebra.
 */
import { createHash } from 'node:crypto';
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
  PluginNotesScope,
  PluginUi,
  PluginUnregister,
  PluginVault,
  PluginWorkspace
} from 'hebra-plugin-api';
import { createFakePluginApi, FAKE_ROOT_FOLDER_ID, type FakePluginApi } from 'hebra-plugin-api/testing';
import { setFrontmatterProperty } from '../../../src/vault/frontmatter-lines';

export { FAKE_ROOT_FOLDER_ID };

// ---- títulos y notas ----

/** Hebra's `TITLE_MAX_LENGTH` (`library/derive.ts`): the stored title is cut there. */
export const HOST_TITLE_MAX_LENGTH = 200;

/** SHA-256 hex of the UTF-8 body: what Hebra stores as `bodySha256` (`sha256HexOf` in
 *  `sqlite-engine.ts`). The fake hashes the body, never an id plus a counter: otherwise two
 *  identical bodies could never share a hash and a same-body revision could not be tested. */
export function bodySha256Of(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Hebra's `decodeScalar` (`notes/markdown.ts:244`): JSON for `"…"`, the `''` escape for `'…'`. */
function decodeTitleScalar(raw: string): string {
  const scalar = raw.trim();
  if (scalar.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(scalar);
      return typeof decoded === 'string' ? decoded : scalar;
    } catch {
      return scalar.slice(1, scalar.endsWith('"') ? -1 : undefined);
    }
  }
  if (scalar.length >= 2 && scalar.startsWith("'") && scalar.endsWith("'")) {
    return scalar.slice(1, -1).replace(/''/gu, "'");
  }
  return scalar;
}

/** `title:` del frontmatter o, si no hay, el primer `# …`, cortado a 200 caracteres sin
 *  partir un par sustituto (la regla de `PluginVault` y de `deriveNote`, `library/derive.ts`). */
export function titleOf(body: string): string {
  const full = untruncatedTitleOf(body);
  if (full.length <= HOST_TITLE_MAX_LENGTH) return full;
  const cut = full.slice(0, HOST_TITLE_MAX_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function untruncatedTitleOf(body: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(body);
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/u)) {
      const match = /^title:\s*(.*)$/u.exec(line);
      if (!match) continue;
      const decoded = decodeTitleScalar(match[1]).trim();
      if (decoded !== '') return decoded;
    }
  }
  const rest = frontmatter ? body.slice(frontmatter[0].length) : body;
  // Hebra's rule since 25 Sep 2026 (`firstHeading`, `notes/markdown.ts`): only the FIRST
  // non-blank line can be the title, and only as `^\s{0,3}#\s+(.+?)\s*#*\s*$`. A `# …`
  // further down is body: `intro\n\n# Capítulo` has no title.
  const first = rest.split(/\r?\n/u).find((line) => !/^\s*$/u.test(line));
  return first === undefined ? '' : /^\s{0,3}#\s+(.+?)\s*#*\s*$/u.exec(first)?.[1]?.trim() ?? '';
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
    revision: { localSeq: 1, bodySha256: bodySha256Of(body) },
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

/** Hebra's `NOTES_REWRITE_BATCH_MAX` (`hebra/src/lib/library/types.ts`): the host
 *  facade throws `invalid-argument` above it (`plugins/api/vault-facade.ts`). */
export const HOST_REWRITE_BATCH_MAX = 200;

/** An error shaped like the host's `PluginApiError` (`isPluginApiError` accepts it). */
export function hostApiError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'PluginApiError', code });
}

/** Throws exactly where the host does when a rewrite batch is too large. */
export function assertHostRewriteBatchSize(count: number): void {
  if (count > HOST_REWRITE_BATCH_MAX) {
    throw hostApiError('invalid-argument', `Como mucho ${HOST_REWRITE_BATCH_MAX} notas por lote (llegaron ${count}).`);
  }
}

/** The package fake vault (`createFakePluginApi`) has no batch limit: this adds the host one. */
export function withHostRewriteBatchLimit<T extends Pick<PluginVault, 'notesRewriteBatch'>>(vault: T): T {
  const original = vault.notesRewriteBatch.bind(vault);
  vault.notesRewriteBatch = async (entries, options) => {
    assertHostRewriteBatchSize(entries.length);
    return original(entries, options);
  };
  return vault;
}

export class FakeJdexVault implements PluginVault {
  readonly #notes = new Map<string, PluginNote>();
  readonly #folders = new Map<string, PluginFolder>();
  #noteSeq = 0;
  #folderSeq = 0;
  /** Simula un host 1.0.0: `noteSummary` no trae `bodySha256` ni `revision`. */
  omitSummaryBodySha = false;
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
      revision: { localSeq, bodySha256: bodySha256Of(`${locked ? 'locked' : 'open'}:${id}:${localSeq}`) }
    });
  }

  /** The stored note as is (also a protected one, with its body), for test arrangement. */
  peek(id: string): PluginNote {
    return this.#clone(this.#require(id));
  }

  /** The stored body (`''` when protected). */
  peekBody(id: string): string {
    return this.#require(id).body ?? '';
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
      revision: { localSeq, bodySha256: bodySha256Of(body) }
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
      revision: { localSeq: 1, bodySha256: bodySha256Of(input.body) }
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
  ) {
    assertHostRewriteBatchSize(entries.length);
    this.rewriteCalls.push({ entries: entries.map((entry) => ({ ...entry })), options });
    const written: string[] = [];
    const stale: string[] = [];
    const missing: string[] = [];
    const committed: { id: string; body: string; revision: PluginNote['revision'] }[] = [];
    // Host (`vault-facade.ts` `notesRewriteBatch` + `sqlite-engine.ts`): a protected note
    // rejects the WHOLE batch with `note-locked` before anything is written; a purged note
    // goes to `stale` and, apart, to `missing`; a trashed note is still rewritable.
    for (const entry of entries) {
      const current = this.#notes.get(entry.id);
      if (current?.locked) throw hostApiError('note-locked', `La nota «${entry.id}» está protegida: los plugins no pueden cambiar su texto.`);
    }
    for (const entry of entries) {
      const current = this.#notes.get(entry.id);
      if (!current) {
        missing.push(entry.id);
        stale.push(entry.id);
        continue;
      }
      const sameSeq = current.revision.localSeq === entry.expected.localSeq;
      const sameHash = current.revision.bodySha256 === entry.expected.bodySha256.toLowerCase();
      // `strictRevision` wants sequence AND hash; otherwise either one is enough.
      if (!(entry.strictRevision ? sameSeq && sameHash : sameSeq || sameHash)) {
        stale.push(entry.id);
        continue;
      }
      const next = this.#rewritten(current, entry.body);
      this.#notes.set(entry.id, next);
      written.push(entry.id);
      committed.push({ id: entry.id, body: next.body!, revision: { ...next.revision } });
    }
    return { written, stale, ...(missing.length > 0 ? { missing } : {}), committed };
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

  async noteTrashIfUnchanged(id: string, expected: { revision: PluginNote['revision']; folderId: string }): Promise<PluginNote | null> {
    const current = this.#notes.get(id);
    if (!current || current.trashedAt !== null || current.folderId !== expected.folderId || current.revision.localSeq !== expected.revision.localSeq || current.revision.bodySha256 !== expected.revision.bodySha256) return null;
    return this.noteTrash(id);
  }

  async noteMoveIfUnchanged(id: string, folderId: string, expected: { revision: PluginNote['revision']; folderId: string }): Promise<PluginNote | null> {
    const current = this.#notes.get(id);
    if (!current || current.trashedAt !== null || current.folderId !== expected.folderId || current.revision.localSeq !== expected.revision.localSeq || current.revision.bodySha256 !== expected.revision.bodySha256) return null;
    return this.noteMove(id, folderId);
  }

  async noteRestoreIfUnchanged(id: string, expected: { trashedAt: number; revision: PluginNote['revision'] }): Promise<PluginNote | null> {
    const current = this.#notes.get(id);
    if (!current || current.trashedAt !== expected.trashedAt || current.revision.localSeq !== expected.revision.localSeq || current.revision.bodySha256 !== expected.revision.bodySha256) return null;
    const restored = { ...current, trashedAt: null, revision: { ...current.revision, localSeq: current.revision.localSeq + 1 } };
    this.#notes.set(id, restored);
    return this.#clone(restored);
  }

  async noteRestore(id: string, expected: { trashedAt: number; revision: PluginNote['revision'] }): Promise<boolean> {
    return (await this.noteRestoreIfUnchanged(id, expected)) !== null;
  }

  async noteSummary(ids: readonly string[]): Promise<PluginNoteSummary[]> {
    return ids.flatMap((id) => {
      const note = this.#notes.get(id);
      if (!note) return [];
      const summary = {
        id: note.id,
        title: note.title,
        excerpt: '',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        favorite: note.favorite,
        locked: note.locked,
        folderId: note.folderId,
        trashedAt: note.trashedAt,
        archivedAt: note.archivedAt,
        revision: this.omitSummaryBodySha ? null : { ...note.revision },
        bodySha256: note.revision.bodySha256
      };
      // Con un host 1.0.0 el campo no llega en absoluto (no es un `undefined` explícito).
      if (this.omitSummaryBodySha) delete (summary as { bodySha256?: string }).bodySha256;
      return [summary];
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

  async folderRenameIfUnchanged(id: string, name: string, expected: { name: string; parentId: string | null }): Promise<PluginFolder | null> {
    const current = this.#folders.get(id);
    return current && current.name === expected.name && current.parentId === expected.parentId ? this.folderRename(id, name) : null;
  }

  async folderMoveIfUnchanged(id: string, parentId: string | null, expected: { name: string; parentId: string | null }): Promise<PluginFolder | null> {
    const current = this.#folders.get(id);
    return current && current.name === expected.name && current.parentId === expected.parentId ? this.folderMove(id, parentId) : null;
  }

  async folderTrashEmpty(id: string, expected: { name: string; parentId: string | null }): Promise<boolean> {
    // Host (`sqlite-engine.ts` `folderTrashEmpty`): the root never goes, a `null` parent
    // means the root, and a live subfolder or any note inside blocks it.
    const root = this.rootFolderId();
    const current = this.#folders.get(id);
    if (id === root || !current || current.name !== expected.name || (current.parentId ?? root) !== (expected.parentId ?? root)) return false;
    if ([...this.#folders.values()].some((folder) => folder.parentId === id) || [...this.#notes.values()].some((note) => note.folderId === id)) return false;
    this.#folders.delete(id);
    return true;
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

// ---- capabilities ----

const VAULT_READ_METHODS: ReadonlySet<string> = new Set([
  'libraryId', 'rootFolderId', 'noteRead', 'noteSummary', 'notesPage', 'foldersList', 'filesPage', 'fileRead', 'blobRead', 'onChange'
]);

const SYNC_VAULT_METHODS: ReadonlySet<string> = new Set(['libraryId', 'rootFolderId', 'onChange']);

/**
 * The host gates every `api.vault` call on `vault.read` / `vault.write` (`vault-facade.ts`
 * `read()`/`write()`): an undeclared capability throws `capability-not-declared` before the
 * store is touched. This wraps any vault with the same gate.
 */
export function withVaultCapabilities<T extends PluginVault>(vault: T, capabilities: readonly PluginCapability[]): T {
  const declared = new Set<PluginCapability>(capabilities);
  return new Proxy(vault, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      const needed: PluginCapability = VAULT_READ_METHODS.has(property) ? 'vault.read' : 'vault.write';
      return (...args: unknown[]) => {
        if (!declared.has(needed)) {
          const error = hostApiError('capability-not-declared', `«${needed}» sin declarar.`);
          // `libraryId`, `rootFolderId` and `onChange` are synchronous in the host: they throw.
          if (SYNC_VAULT_METHODS.has(property)) throw error;
          return Promise.reject(error);
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}

// ---- markdown ----

/**
 * Doble de `api.markdown.setProperty`: el port fiel de `setMarkdownProperty` de Hebra
 * (`src/vault/frontmatter-lines.ts`), comprobado contra casos medidos en el host. Incluye
 * los casos «no parcheable» (clave repetida, línea raíz no reconocida…), en los que el
 * host devuelve el cuerpo sin cambios, y `null`, que deja la clave vacía.
 */
export function fakeSetProperty(
  body: string,
  key: string,
  value: string | readonly string[] | null
): string {
  // The host returns the body unchanged where the port refuses.
  return setFrontmatterProperty(body, key, value) ?? body;
}

// ---- workspace ----

/** Hebra's per-guard deadline in `confirmFolderRename` (`src/lib/plugins/api/
 *  workspace-bridge.ts`, `FOLDER_RENAME_GUARD_TIMEOUT_MS`): past it the guard counts as
 *  allowing the change. Keep in step with the host. */
export const FOLDER_RENAME_GUARD_TIMEOUT_MS = 5_000;

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

  /** Errors thrown by a listener. The host (`workspace-bridge.ts` `#emit`) reports them and
   *  keeps notifying the rest: one plugin listener never stops the others. */
  readonly listenerFaults: unknown[] = [];

  #emit<T>(listeners: Iterable<(value: T) => void>, value: T): void {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.listenerFaults.push(error);
      }
    }
  }

  setActiveNote(note: PluginActiveNote | null): void {
    this.active = note;
    this.#emit(this.#activeListeners, note);
  }

  emitFolders(folders: readonly PluginFolder[]): void {
    this.#emit(this.#foldersListeners, folders);
  }

  emitNotes(change: PluginNotesChange): void {
    this.#emit(this.#notesListeners, change);
  }

  emitTitleRenamed(event: PluginNoteTitleRenamedEvent): void {
    this.#emit(this.#titleListeners, event);
  }

  /** Faults the host would report (`workspace.onBeforeFolderRename`): a guard that threw or
   *  did not answer in time. */
  readonly guardFaults: unknown[] = [];

  /** Like Hebra's `confirmFolderRename` (`workspace-bridge.ts`): the guards are asked in
   *  order and one `false` is enough; each one gets `FOLDER_RENAME_GUARD_TIMEOUT_MS`, and a
   *  guard that throws or does not answer in time is reported and counts as ALLOW. */
  async askFolderRename(event: PluginFolderRenameEvent): Promise<boolean> {
    for (const guard of [...this.#guards]) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`la guardia no respondió en ${FOLDER_RENAME_GUARD_TIMEOUT_MS / 1000} s`)),
            FOLDER_RENAME_GUARD_TIMEOUT_MS
          );
        });
        if ((await Promise.race([guard(event), deadline])) === false) return false;
      } catch (error) {
        this.guardFaults.push(error);
      } finally {
        clearTimeout(timer);
      }
    }
    return true;
  }

  /** Like Hebra's sidebar (`LibraryApp.svelte`, `onrenamefolder`/`onmovefolder`): asks the
   *  guards and, if they allow it, renames or moves the folder in `vault`. */
  async changeFolderAsHost(vault: PluginVault, event: PluginFolderRenameEvent): Promise<boolean> {
    if (!(await this.askFolderRename(event))) return false;
    if (event.kind === 'folder-rename') await vault.folderRename(event.folderId, event.newName);
    else await vault.folderMove(event.folderId, event.newParentId);
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
      const handle: PluginModalHandle = {
        close() {
          if (closed) return;
          closed = true;
          if (typeof cleanup === 'function') cleanup();
          dialog.remove();
          options?.onClosed?.();
        }
      };
      // Escape on a `<dialog>` fires `cancel`; the host closes the modal (and calls
      // `onClosed`) without any button. Tests dispatch `new Event('cancel')`.
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        handle.close();
      });
      return handle;
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
