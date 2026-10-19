/**
 * Adaptador de `LibraryPort` (la interfaz por ids del motor, `src/jd/library-port.ts`)
 * sobre la API de plugins de Hebra (`PluginVault`, `PluginMarkdown`). Con él, el flujo
 * «Crear ID» del plugin pasa por `resolveSettings`/`loadLibraryState`/`planNewId`/`applyPlan`
 * y da exactamente lo mismo que hebra-mcp.
 *
 * `hasHidden` es siempre `false`: el plugin ve la biblioteca entera de su usuario y la API
 * de plugins no expone carpetas privadas ni inaccesibles. Lo único que la API protege son
 * las NOTAS (`locked: true`, `body: null`), que siguen listadas con su título —así que su
 * número cuenta como ocupado— y cuyo cuerpo `readNote` entrega como `null` (el motor la
 * salta como plantilla).
 */
import type { PluginMarkdown, PluginNote, PluginVault } from 'hebra-plugin-api/v2';
import { mergeSettings, type EnsureResult, type JdIndex, type JdexManagerSettings, type LibraryMovePort, type LibraryPort, type LibraryState, type PortFolder, type PortNote } from './engine';
import type { JdexLibraryWalk } from './library-index';

const NOTES_PAGE_SIZE = 200;

/** Lo que usa el adaptador del `vault` de la API. */
export type HebraLibraryVault = Pick<PluginVault, 'noteCreate' | 'noteRead' | 'folderCreate' | 'foldersList' | 'notesPage' | 'rootFolderId'>;

/** Lo que usa `HebraMovePort` del `vault`: lo de `HebraLibraryVault` más mover y renombrar. */
export type HebraMoveVault = HebraLibraryVault &
  Pick<PluginVault, 'noteMove' | 'noteMoveIfUnchanged' | 'noteSave' | 'folderMoveIfUnchanged' | 'folderRenameIfUnchanged' | 'filesPage'>;

const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC');

export class HebraLibraryPort implements LibraryPort {
  /** Las notas que `ensureNote` ha creado, por id: el flujo devuelve la nota completa. */
  readonly created = new Map<string, PluginNote>();

  constructor(
    private readonly vault: HebraLibraryVault,
    private readonly markdown: Pick<PluginMarkdown, 'withTitle'>
  ) {}

  async listFolders(): Promise<PortFolder[]> {
    const rootId = this.vault.rootFolderId();
    // La raíz de la biblioteca no es una carpeta más (el host falso de la API la lista).
    return (await this.vault.foldersList())
      .filter((folder) => folder.id !== rootId)
      .map((folder) => ({ id: folder.id, parentId: folder.parentId, name: folder.name }));
  }

  async listNotes(folderId: string): Promise<PortNote[]> {
    const out: PortNote[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.vault.notesPage(cursor, NOTES_PAGE_SIZE, { kind: 'folder', folderId });
      for (const item of page.items) out.push({ id: item.id, title: item.title });
      cursor = page.nextCursor;
    } while (cursor !== null);
    return out;
  }

  async readNote(id: string): Promise<{ body: string | null }> {
    const row = await this.vault.noteRead(id);
    return { body: row?.body ?? null };
  }

  async ensureFolder(parentId: string | null, name: string): Promise<EnsureResult> {
    const wanted = name.trim().toLowerCase();
    const existing = (await this.vault.foldersList()).find(
      (folder) => folder.parentId === parentId && folder.name.trim().toLowerCase() === wanted
    );
    if (existing) return { id: existing.id, created: false };
    return { id: (await this.vault.folderCreate(parentId, name)).id, created: true };
  }

  /** Crea la nota con `title:` fijado por `markdown.withTitle`: el título de la biblioteca es
   *  SIEMPRE `title`, aunque el cuerpo lleve otro encabezado. */
  async ensureNote(folderId: string, title: string, body: string): Promise<EnsureResult> {
    const existing = (await this.listNotes(folderId)).find((note) => note.title === title);
    if (existing) return { id: existing.id, created: false };
    const note = await this.vault.noteCreate({ folderId, body: this.markdown.withTitle(body, title) });
    this.created.set(note.id, note);
    return { id: note.id, created: true };
  }

  async hasHidden(): Promise<boolean> {
    return false;
  }
}

/**
 * `LibraryMovePort` sobre la API de plugins: lo que el motor necesita para «mover a un ID».
 * Cada movimiento comprueba antes lo esperado y usa las variantes `IfUnchanged` de la API
 * (que fallan sin efectos si la nota o la carpeta cambió). `{ ok: false }` = ya no está como
 * se esperaba. La API no tiene mover ni renombrar ficheros sueltos, así que `moveFile`
 * siempre devuelve `{ ok: false }` (el plugin solo mueve la nota activa).
 */
export class HebraMovePort extends HebraLibraryPort implements LibraryMovePort {
  constructor(
    private readonly moveVault: HebraMoveVault,
    private readonly moveMarkdown: Pick<PluginMarkdown, 'withTitle'>
  ) {
    super(moveVault, moveMarkdown);
  }

  async listFiles(folderId: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.moveVault.filesPage(folderId, false, cursor, NOTES_PAGE_SIZE);
      for (const file of page.items) if (file.trashedAt === null) out.push({ id: file.id, name: file.name });
      cursor = page.nextCursor;
    } while (cursor !== null);
    return out;
  }

  /** El usuario del plugin ve toda su biblioteca: nada oculto. */
  async hiddenInside(): Promise<boolean> {
    return false;
  }

  async moveNote(id: string, expected: { folderId: string; title: string }, to: { folderId: string; title?: string }): Promise<{ ok: boolean }> {
    const note = await this.moveVault.noteRead(id);
    if (!note || note.trashedAt !== null || note.folderId !== expected.folderId || !same(note.title, expected.title)) return { ok: false };
    let current = note;
    if (to.folderId !== note.folderId) {
      // Una nota protegida no se puede mover con guarda de revisión: se mueve sin ella, como siempre.
      const moved = note.locked
        ? await this.moveVault.noteMove(id, to.folderId)
        : await this.moveVault.noteMoveIfUnchanged(id, to.folderId, { revision: note.revision, folderId: note.folderId });
      if (!moved) return { ok: false };
      current = moved;
    }
    if (to.title !== undefined && !same(to.title, note.title)) {
      if (current.locked || current.body === null) return { ok: false };
      const saved = await this.moveVault.noteSave({ id, body: this.moveMarkdown.withTitle(current.body, to.title), expected: current.revision });
      if (saved.outcome !== 'saved') return { ok: false };
    }
    return { ok: true };
  }

  async moveFile(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async moveFolder(id: string, expected: { parentId: string; name: string }, to: { parentId: string; name?: string }): Promise<{ ok: boolean }> {
    const folder = (await this.moveVault.foldersList()).find((candidate) => candidate.id === id);
    if (!folder || folder.parentId !== expected.parentId || !same(folder.name, expected.name)) return { ok: false };
    if (to.parentId !== folder.parentId && !(await this.moveVault.folderMoveIfUnchanged(id, to.parentId, { name: folder.name, parentId: folder.parentId }))) return { ok: false };
    if (to.name !== undefined && !same(to.name, folder.name) && !(await this.moveVault.folderRenameIfUnchanged(id, to.name, { name: folder.name, parentId: to.parentId }))) return { ok: false };
    return { ok: true };
  }
}

/**
 * El `LibraryState` del motor a partir de lo que el plugin YA tiene: el recorrido de la
 * biblioteca (`walk`, con sus rutas y el desempate de notas con el mismo título) y el
 * índice, en vez de volver a listar la biblioteca. Los ajustes son los del plugin (no la
 * convención 00.00/00.03). `applyPlan` sí relee la biblioteca por el puerto para comprobar
 * las precondiciones.
 */
export function jdexLibraryState(
  walk: JdexLibraryWalk,
  index: JdIndex,
  settings: Partial<JdexManagerSettings>,
  jdexFolderId: string
): LibraryState {
  const merged = mergeSettings(settings);
  const folders = [...walk.folderPaths].map(([id, path]) => ({
    id,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    parentId: path.includes('/') ? walk.folderIdByPath?.get(path.slice(0, path.lastIndexOf('/'))) ?? null : null
  }));
  const folderIdByPath = new Map<string, string>();
  for (const folder of [...folders].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!folderIdByPath.has(folder.path)) folderIdByPath.set(folder.path, folder.id);
  }
  const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const templatesId = merged.templatesFolder === '' ? null : folderIdByPath.get(merged.templatesFolder) ?? null;
  return {
    resolved: {
      settings: merged,
      jdex: { id: jdexFolderId, name: lastName(merged.jdexFolder), path: merged.jdexFolder },
      templates: templatesId === null ? null : { id: templatesId, name: lastName(merged.templatesFolder), path: merged.templatesFolder }
    },
    index,
    folders,
    folderIdByPath,
    jdexNotes: walk.systemNotes.filter((note) => note.folderId === jdexFolderId).map((note) => ({ id: note.id, title: note.title, path: note.path })),
    templateNotes: templatesId === null ? [] : walk.systemNotes.filter((note) => note.folderId === templatesId).map((note) => ({ id: note.id, title: note.title }))
  };
}
