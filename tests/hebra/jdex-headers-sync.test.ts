import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import { refreshJdexHeaders, refreshJdexSystemIndex } from '../../src/hebra/jdex-headers-sync';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeNote } from './support/fakes';

const JDEX_FOLDER = '00.00 JDex';

function systemFixture(headerBody: string, indexBody: string) {
  const folderPaths = [
    JDEX_FOLDER,
    '20-29 Productos',
    '20-29 Productos/21 Productos de software',
    '20-29 Productos/21 Productos de software/21.10 ■ Cabecera',
    '20-29 Productos/21 Productos de software/21.11 Hebra',
    '20-29 Productos/21 Productos de software/21.12 Otro'
  ];
  const headerPath = `${JDEX_FOLDER}/21.10 ■ Cabecera.md`;
  const indexPath = `${JDEX_FOLDER}/00.00 JDex del sistema.md`;
  const notePaths = [
    `${JDEX_FOLDER}/00.00 JDex del sistema.md`,
    `${JDEX_FOLDER}/20-29 Productos.md`,
    `${JDEX_FOLDER}/21 Productos de software.md`,
    headerPath,
    `${JDEX_FOLDER}/21.11 Hebra.md`,
    `${JDEX_FOLDER}/21.12 Otro.md`
  ];
  const input: IndexInput = { systemRoot: '', jdexFolder: JDEX_FOLDER, folderPaths, notePaths };
  const index = buildIndex(input);

  const systemNotes: JdexNoteRef[] = [
    { id: 'n-0000', folderId: 'f-jdex', title: '00.00 JDex del sistema', path: indexPath },
    {
      id: 'n-area20',
      folderId: 'f-jdex',
      title: '20-29 Productos',
      path: `${JDEX_FOLDER}/20-29 Productos.md`
    },
    {
      id: 'n-cat21',
      folderId: 'f-jdex',
      title: '21 Productos de software',
      path: `${JDEX_FOLDER}/21 Productos de software.md`
    },
    { id: 'n-2110', folderId: 'f-jdex', title: '21.10 ■ Cabecera', path: headerPath },
    {
      id: 'n-2111',
      folderId: 'f-jdex',
      title: '21.11 Hebra',
      path: `${JDEX_FOLDER}/21.11 Hebra.md`
    },
    { id: 'n-2112', folderId: 'f-jdex', title: '21.12 Otro', path: `${JDEX_FOLDER}/21.12 Otro.md` }
  ];
  const walk: JdexLibraryWalk = {
    rootFolderId: 'root',
    folderPaths: new Map([['f-jdex', JDEX_FOLDER]]),
    systemFolderPaths: folderPaths,
    systemNotes
  };

  const library = new FakeJdexVault();
  library.seedNote(fakeNote('n-2110', 'f-jdex', headerBody));
  library.seedNote(fakeNote('n-0000', 'f-jdex', indexBody));

  return { index, walk, library, headerId: 'n-2110', indexId: 'n-0000' };
}

describe('refreshJdexHeaders', () => {
  it('regenera la lista de hijos entre marcadores, ordenada por número', async () => {
    const headerBody = [
      '---',
      'jd: 21.10',
      'tipo: cabecera',
      '---',
      '# 21.10 ■ Cabecera',
      '',
      '<!-- jdex:hijos -->',
      '<!-- /jdex:hijos -->',
      ''
    ].join('\n');
    const { walk, index, library, headerId } = systemFixture(headerBody, '');
    const result = await refreshJdexHeaders(library, walk, index);
    expect(result.written).toEqual([headerId]);
    const after = await library.noteRead(headerId);
    expect(after?.body).toContain(
      '<!-- jdex:hijos -->\n- [[21.11 Hebra]]\n- [[21.12 Otro]]\n<!-- /jdex:hijos -->'
    );
  });

  it('una cabecera SIN marcadores queda intacta (contrato: no se toca)', async () => {
    const headerBody = [
      '---',
      'jd: 21.10',
      'tipo: cabecera',
      '---',
      '# 21.10 ■ Cabecera',
      '',
      'Sin marcadores.',
      ''
    ].join('\n');
    const { walk, index, library, headerId } = systemFixture(headerBody, '');
    const result = await refreshJdexHeaders(library, walk, index);
    expect(result.written).toHaveLength(0);
    const after = await library.noteRead(headerId);
    expect(after?.body).toBe(headerBody);
  });
});

describe('refreshJdexSystemIndex', () => {
  it('regenera el índice del sistema completo entre marcadores', async () => {
    const indexBody = [
      '---',
      'jd: 00.00',
      'tipo: id',
      '---',
      '# 00.00 JDex del sistema',
      '',
      '<!-- jdex:indice -->',
      '<!-- /jdex:indice -->',
      ''
    ].join('\n');
    const { walk, index, library, indexId } = systemFixture('', indexBody);
    const result = await refreshJdexSystemIndex(library, walk, index, '');
    expect(result.written).toEqual([indexId]);
    const after = await library.noteRead(indexId);
    expect(after?.body).toContain('[[20-29 Productos]]');
    expect(after?.body).toContain('[[21 Productos de software]]');
    expect(after?.body).toContain('[[21.10 ■ Cabecera]]');
    expect(after?.body).toContain('[[21.11 Hebra]]');
  });

  it('sin nota del 00.00 (`systemIndexNote` vacío y ningún ID «00.00»), no hace nada', async () => {
    const input: IndexInput = {
      systemRoot: '',
      jdexFolder: JDEX_FOLDER,
      folderPaths: [],
      notePaths: []
    };
    const index = buildIndex(input);
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map(),
      systemFolderPaths: [],
      systemNotes: []
    };
    const library = new FakeJdexVault();
    const result = await refreshJdexSystemIndex(library, walk, index, '');
    expect(result).toEqual({ written: [], skipped: [] });
  });
});
