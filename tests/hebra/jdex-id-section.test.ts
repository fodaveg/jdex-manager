import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import { loadJdexIdSection } from '../../src/hebra/jdex-id-section';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeNote } from './support/fakes';

const markdown = createFakePluginApi().api.markdown;

const INDEX_INPUT: IndexInput = {
  systemRoot: '',
  folderPaths: [
    '00-09 Sistema/00 Sistema/00.00 JDex',
    '20-29 Productos/21 Productos de software',
    '20-29 Productos/21 Productos de software/21.11 Hebra',
    '20-29 Productos/21 Productos de software/21.12 Otro'
  ],
  jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex',
  notePaths: [
    '00-09 Sistema/00 Sistema/00.00 JDex/21.11 Hebra.md',
    '00-09 Sistema/00 Sistema/00.00 JDex/21.12 Otro.md'
  ]
};

function walk(): JdexLibraryWalk {
  const folderPaths = new Map([
    ['f-jdex', '00-09 Sistema/00 Sistema/00.00 JDex'],
    ['f-cat', '20-29 Productos/21 Productos de software'],
    ['f-hebra', '20-29 Productos/21 Productos de software/21.11 Hebra'],
    ['f-otro', '20-29 Productos/21 Productos de software/21.12 Otro']
  ]);
  return {
    rootFolderId: 'root',
    folderPaths,
    systemFolderPaths: [...folderPaths.values()],
    systemNotes: [
      {
        id: 'n-hebra',
        folderId: 'f-jdex',
        title: '21.11 Hebra',
        path: '00-09 Sistema/00 Sistema/00.00 JDex/21.11 Hebra.md'
      },
      {
        id: 'n-otro',
        folderId: 'f-jdex',
        title: '21.12 Otro',
        path: '00-09 Sistema/00 Sistema/00.00 JDex/21.12 Otro.md'
      },
      { id: 'n-content', folderId: 'f-hebra', title: 'Notas de Hebra', path: 'x.md' }
    ]
  };
}

function fakeLibrary(): FakeJdexVault {
  const vault = new FakeJdexVault();
  vault.seedNote(
    fakeNote('n-hebra', 'f-jdex', ['---', 'jd: 21.11', 'descripcion: Notas locales.', '---', ''].join('\n'), { title: '21.11 Hebra' })
  );
  vault.seedNote(fakeNote('n-content', 'f-hebra', '', { title: 'Notas de Hebra', updatedAt: 100, createdAt: 0 }));
  vault.seedFile({
    id: 'f1',
    folderId: 'f-hebra',
    name: 'captura.png',
    sha256: 'sha',
    byteLength: 1,
    mime: 'image/png',
    createdAt: 0,
    updatedAt: 200,
    trashedAt: null
  });
  return vault;
}

describe('loadJdexIdSection', () => {
  it('sin nota activa, datos vacíos', async () => {
    const index = buildIndex(INDEX_INPUT);
    const data = await loadJdexIdSection(
      fakeLibrary(),
      markdown,
      walk(),
      index,
      { jdexFolder: INDEX_INPUT.jdexFolder },
      null
    );
    expect(data.entry).toBeNull();
  });

  it('la nota JDex del ID: ruta, descripción, ficheros de la carpeta y hermanos', async () => {
    const index = buildIndex(INDEX_INPUT);
    const data = await loadJdexIdSection(
      fakeLibrary(),
      markdown,
      walk(),
      index,
      { jdexFolder: INDEX_INPUT.jdexFolder },
      { id: 'n-hebra', folderId: 'f-jdex', title: '21.11 Hebra' }
    );
    expect(data.entry?.id).toBe('21.11');
    expect(data.description).toBe('Notas locales.');
    // La nota de contenido y el fichero, ordenados por fecha descendente.
    expect(data.files.map((f) => f.name)).toEqual(['captura.png', 'Notas de Hebra']);
    expect(data.files.find((f) => f.kind === 'note')?.id).toBe('n-content');
    expect(data.siblings.map((s) => s.id)).toEqual(['21.12']);
    expect(data.siblingsTitle).toBe('21.11 a 21.19');
    expect(data.children).toEqual([]);
  });

  it('lists only the siblings under the header of the ID, not the whole category', async () => {
    const base = '20-29 P/21 Cat';
    const folders = ['20-29 P', base, `${base}/21.10 Cabecera A`, `${base}/21.11 Uno`, `${base}/21.12 Dos`, `${base}/21.20 Cabecera B`, `${base}/21.21 Tres`, `${base}/21.01 Inbox`];
    const index = buildIndex({ systemRoot: '', jdexFolder: '', notePaths: [], folderPaths: folders });
    const w: JdexLibraryWalk = { rootFolderId: 'root', folderPaths: new Map([['f-uno', `${base}/21.11 Uno`]]), systemFolderPaths: folders, systemNotes: [] };
    const data = await loadJdexIdSection(fakeLibrary(), markdown, w, index, { jdexFolder: '' }, { id: 'n', folderId: 'f-uno', title: 'Nota' });
    expect(data.entry?.id).toBe('21.11');
    expect(data.siblings.map((s) => s.id)).toEqual(['21.12']);
    expect(data.siblingsTitle).toBe('Bajo 21.10 Cabecera A');
    // an inbox hangs from no header: no siblings, empty title
    const inboxWalk: JdexLibraryWalk = { ...w, folderPaths: new Map([['f-in', `${base}/21.01 Inbox`]]) };
    const inbox = await loadJdexIdSection(fakeLibrary(), markdown, inboxWalk, index, { jdexFolder: '' }, { id: 'n', folderId: 'f-in', title: 'Nota' });
    expect(inbox.siblings).toEqual([]);
    expect(inbox.siblingsTitle).toBe('');
  });

  it('flags a truncated listing when the page has a next cursor', async () => {
    const index = buildIndex(INDEX_INPUT);
    const library = Object.assign(fakeLibrary(), { notesPage: async () => ({ items: [], nextCursor: 'more' }) });
    const data = await loadJdexIdSection(library, markdown, walk(), index, { jdexFolder: INDEX_INPUT.jdexFolder },
      { id: 'n-hebra', folderId: 'f-jdex', title: '21.11 Hebra' });
    expect(data.truncated).toEqual({ notes: true, files: false });
    expect(data.contentsLimit).toBe(200);
  });
});
