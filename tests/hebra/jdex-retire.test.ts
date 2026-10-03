import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput, type IdEntry, type JdIndex } from '../../src/hebra/engine';
import { retireJdexId } from '../../src/hebra/jdex-retire';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeFolder, fakeNote, fakeSetProperty } from './support/fakes';

const markdown = { setProperty: fakeSetProperty };

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
});
