import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import { applyJdexWrap, findJdexWrapCandidates } from '../../src/hebra/jdex-wrap-headers';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeNote } from './support/fakes';

const JDEX_FOLDER = '00.00 JDex';

function headerFixture(headerId: string, _headerBody: string) {
  const headerPath = `${JDEX_FOLDER}/21.10 ■ Cabecera.md`;
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: JDEX_FOLDER,
    folderPaths: [JDEX_FOLDER, '20-29 Productos', '20-29 Productos/21 Productos de software'],
    notePaths: [headerPath]
  };
  const index = buildIndex(input);
  const systemNotes: JdexNoteRef[] = [
    { id: headerId, folderId: 'f-jdex', title: '21.10 ■ Cabecera', path: headerPath }
  ];
  const walk: JdexLibraryWalk = {
    rootFolderId: 'root',
    folderPaths: new Map([['f-jdex', JDEX_FOLDER]]),
    systemFolderPaths: [],
    systemNotes
  };
  return { index, walk, headerPath };
}

describe('findJdexWrapCandidates', () => {
  it('una cabecera con lista de enlaces SIN marcadores es candidata', () => {
    const { index, walk } = headerFixture('n-2110', '');
    const body = '# 21.10 ■ Cabecera\n\n- [[21.11 Hebra]]\n- [[21.12 Otro]]\n';
    const candidates = findJdexWrapCandidates(walk, index, () => body);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].after).toContain('<!-- jdex:hijos -->');
    expect(candidates[0].after).toContain('- [[21.11 Hebra]]');
  });

  it('una cabecera que YA tiene marcadores no es candidata', () => {
    const { index, walk } = headerFixture('n-2110', '');
    const body = '# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n';
    const candidates = findJdexWrapCandidates(walk, index, () => body);
    expect(candidates).toHaveLength(0);
  });

  it('una cabecera sin ninguna lista de enlaces no es candidata', () => {
    const { index, walk } = headerFixture('n-2110', '');
    const body = '# 21.10 ■ Cabecera\n\nSin nada que envolver.\n';
    const candidates = findJdexWrapCandidates(walk, index, () => body);
    expect(candidates).toHaveLength(0);
  });
});

describe('applyJdexWrap', () => {
  it('solo escribe las notas marcadas', async () => {
    const { index, walk } = headerFixture('n-2110', '');
    const body = '# 21.10 ■ Cabecera\n\n- [[21.11 Hebra]]\n';
    const candidates = findJdexWrapCandidates(walk, index, () => body);
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n-2110', 'f-jdex', body));

    const noneApplied = await applyJdexWrap(library, candidates, []);
    expect(noneApplied.written).toHaveLength(0);
    expect((await library.noteRead('n-2110'))?.body).toBe(body);

    const applied = await applyJdexWrap(library, candidates, ['n-2110']);
    expect(applied.written).toEqual(['n-2110']);
    expect((await library.noteRead('n-2110'))?.body).toContain('<!-- jdex:hijos -->');
  });
});
