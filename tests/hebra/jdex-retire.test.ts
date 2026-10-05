import { parse as parseYaml } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { buildIndex, type IndexInput, type IdEntry, type JdIndex } from '../../src/hebra/engine';
import { createJdexJournal } from '../../src/hebra/jdex-journal';
import { retireJdexId } from '../../src/hebra/jdex-retire';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeFolder, fakeNote, fakeSetProperty } from './support/fakes';

const markdown = {
  ...createFakePluginApi().api.markdown,
  setProperty: fakeSetProperty,
  frontmatter(body: string): Record<string, unknown> | null {
    const block = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(body)?.[1];
    const value: unknown = block ? parseYaml(block) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }
};

const JDEX_FOLDER = '00.00 JDex';
const CATEGORY_PATH = '20-29 Productos/21 Productos de software';
const ARCHIVE_PATH = `${CATEGORY_PATH}/21.09 Archivo`;
const ID_FOLDER_PATH = `${CATEGORY_PATH}/21.11 Hebra`;
const NOTE_PATH = `${JDEX_FOLDER}/21.11 Hebra.md`;

function fixture(): {
  index: JdIndex;
  walk: JdexLibraryWalk;
  entry: IdEntry;
  library: FakeJdexVault;
} {
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: JDEX_FOLDER,
    folderPaths: [JDEX_FOLDER, '20-29 Productos', CATEGORY_PATH, ARCHIVE_PATH, ID_FOLDER_PATH],
    notePaths: [NOTE_PATH]
  };
  const index = buildIndex(input);
  const entry = index.ids.find((id) => id.id === '21.11');
  if (!entry) throw new Error('fixture: 21.11 no se construyó en el índice.');

  const systemNotes: JdexNoteRef[] = [
    { id: 'n-2111', folderId: 'f-jdex', title: '21.11 Hebra', path: NOTE_PATH }
  ];
  const walk: JdexLibraryWalk = {
    rootFolderId: 'root',
    folderPaths: new Map([
      ['f-jdex', JDEX_FOLDER],
      ['f-productos', '20-29 Productos'],
      ['f-cat21', CATEGORY_PATH],
      ['f-2109', ARCHIVE_PATH],
      ['f-2111', ID_FOLDER_PATH]
    ]),
    systemFolderPaths: [],
    systemNotes
  };

  const library = new FakeJdexVault();
  library.seedFolder(fakeFolder('f-2111', 'f-cat21', '21.11 Hebra'));
  library.seedFolder(fakeFolder('f-2109', 'f-cat21', '21.09 Archivo'));
  library.seedNote(fakeNote('n-2111', 'f-jdex', '# 21.11 Hebra\n\nDescripción del ID.\n'));

  return { index, walk, entry, library };
}

describe('retireJdexId', () => {
  it('marca archivado la nota y mueve la carpeta a la .09 de su categoría, con la fecha delante', async () => {
    const { index, walk, entry, library } = fixture();

    const outcome = await retireJdexId(library, markdown, walk, index, entry, '2026-09-28');

    expect(outcome.moved).toBe(true);
    expect(outcome.plan.move).toEqual({
      from: ID_FOLDER_PATH,
      to: `${ARCHIVE_PATH}/2026-09-28 21.11 Hebra`
    });

    const note = await library.noteRead('n-2111');
    expect(note?.body).toContain('tipo: "archivado"');
    expect(note?.body).toContain('archivado: "2026-09-28"');
    expect(note?.body).toContain('Retirado el 2026-09-28.');

    const folders = await library.foldersList();
    const folder = folders.find((f) => f.id === 'f-2111');
    expect(folder?.name).toBe('2026-09-28 21.11 Hebra');
    expect(folder?.parentId).toBe('f-2109');
  });

  it('el número no se reutiliza: la nota JDex del ID se conserva con el mismo id', async () => {
    const { index, walk, entry, library } = fixture();
    await retireJdexId(library, markdown, walk, index, entry, '2026-09-28');
    const note = await library.noteRead('n-2111');
    expect(note).not.toBeNull();
  });

  it('sin carpeta propia, solo marca la nota (moved: false)', async () => {
    const input: IndexInput = {
      systemRoot: '',
      jdexFolder: JDEX_FOLDER,
      folderPaths: [JDEX_FOLDER],
      notePaths: [NOTE_PATH]
    };
    const index = buildIndex(input);
    const entry = index.ids.find((id) => id.id === '21.11');
    if (!entry) throw new Error('fixture: 21.11 no se construyó en el índice.');
    expect(entry.folderPath).toBeUndefined();

    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map([['f-jdex', JDEX_FOLDER]]),
      systemFolderPaths: [],
      systemNotes: [{ id: 'n-2111', folderId: 'f-jdex', title: '21.11 Hebra', path: NOTE_PATH }]
    };
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n-2111', 'f-jdex', '# 21.11 Hebra\n\nDescripción.\n'));

    const outcome = await retireJdexId(library, markdown, walk, index, entry, '2026-09-28');
    expect(outcome.moved).toBe(false);
    expect(outcome.plan.move).toBeUndefined();
    const note = await library.noteRead('n-2111');
    expect(note?.body).toContain('tipo: "archivado"');
  });

  it('sin nota JDex del ID, lanza (nada que marcar como retirado)', async () => {
    const input: IndexInput = {
      systemRoot: '',
      jdexFolder: JDEX_FOLDER,
      folderPaths: [JDEX_FOLDER, '20-29 Productos', CATEGORY_PATH, ID_FOLDER_PATH],
      notePaths: []
    };
    const index = buildIndex(input);
    const entry = index.ids.find((id) => id.id === '21.11');
    if (!entry) throw new Error('fixture: 21.11 no se construyó en el índice.');
    expect(entry.notePath).toBeUndefined();

    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map([['f-2111', ID_FOLDER_PATH]]),
      systemFolderPaths: [],
      systemNotes: []
    };
    const library = new FakeJdexVault();

    await expect(retireJdexId(library, markdown, walk, index, entry, '2026-09-28')).rejects.toThrow();
  });

  it('una nota bloqueada u obsoleta aborta sin tocar la carpeta', async () => {
    const { index, walk, entry, library } = fixture();
    vi.spyOn(library, 'notesRewriteBatch').mockResolvedValue({ written: [], stale: ['n-2111'], committed: [] });
    await expect(retireJdexId(library, markdown, walk, index, entry, '2026-09-28')).rejects.toThrow('No se pudo marcar');
    expect((await library.foldersList()).find((folder) => folder.id === 'f-2111')).toMatchObject({ name: '21.11 Hebra', parentId: 'f-cat21' });
  });

  it('si falla mover, revierte el renombrado y deja la nota marcada para deshacer', async () => {
    const { index, walk, entry, library } = fixture();
    vi.spyOn(library, 'folderMoveIfUnchanged').mockRejectedValue(new Error('Sin permiso'));
    await expect(retireJdexId(library, markdown, walk, index, entry, '2026-09-28')).rejects.toThrow('Falló el movimiento');
    expect((await library.foldersList()).find((folder) => folder.id === 'f-2111')).toMatchObject({ name: '21.11 Hebra', parentId: 'f-cat21' });
    expect((await library.noteRead('n-2111'))?.body).toContain('archivado:');
  });

  it('un ID ya retirado conserva su fecha y no escribe otra línea', async () => {
    const { index, walk, entry, library } = fixture();
    library.saveElsewhere('n-2111', '---\ntipo: archivado\narchivado: 2026-09-21\n---\n# 21.11 Hebra\nRetirado el 2026-09-21.\n');
    await expect(retireJdexId(library, markdown, walk, index, entry, '2026-09-28')).rejects.toThrow('Ya retirado el 2026-09-21');
    expect(library.rewriteCalls).toHaveLength(0);
    expect((await library.foldersList()).find((folder) => folder.id === 'f-2111')?.name).toBe('21.11 Hebra');
  });
  it('does not overwrite a concurrent rename when compensating a failed move', async () => {
    const { index, walk, entry, library } = fixture();
    vi.spyOn(library, 'folderMoveIfUnchanged').mockRejectedValue(new Error('Move failed'));
    const rename = library.folderRenameIfUnchanged.bind(library);
    let calls = 0;
    vi.spyOn(library, 'folderRenameIfUnchanged').mockImplementation(async (...args) => {
      if (++calls === 2) await library.folderRename('f-2111', 'Manual concurrente');
      return rename(...args);
    });
    await expect(retireJdexId(library, markdown, walk, index, entry, '2026-09-28')).rejects.toThrow('no se pudo revertir');
    expect((await library.foldersList()).find((folder) => folder.id === 'f-2111')?.name).toBe('Manual concurrente');
  });

  it('journals a failed retirement including compensation and undoes every completed step', async () => {
    const { index, walk, entry, library } = fixture();
    const before = (await library.noteRead('n-2111'))!.body;
    const journal = await createJdexJournal(library, createFakePluginApi().api.storage.settings);
    vi.spyOn(library, 'folderMoveIfUnchanged').mockRejectedValue(new Error('Move failed'));
    await expect(journal.run('retire', 'Retire', (tracked) => retireJdexId(tracked, markdown, walk, index, entry, '2026-09-28'))).rejects.toThrow('Falló el movimiento');
    expect(journal.entries()[0].effects.map((effect) => effect.kind)).toEqual(['note-rewrite', 'folder-change', 'folder-change']);
    expect(await journal.undoLast()).toEqual({ undone: 3, warnings: [] });
    expect((await library.noteRead('n-2111'))?.body).toBe(before);
    expect((await library.foldersList()).find((folder) => folder.id === 'f-2111')).toMatchObject({ name: '21.11 Hebra', parentId: 'f-cat21' });
  });

});
