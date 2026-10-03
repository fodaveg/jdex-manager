import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput, type JdIndex } from '../../src/hebra/engine';
import { jdexRenameWarning, jdexRenameWarningMessage } from '../../src/hebra/jdex-rename-guard';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';

const SETTINGS = { jdexFolder: '00.00 JDex', systemRoot: '' };

function fixture(): { index: JdIndex; walk: JdexLibraryWalk } {
  const idPath = '20-29 Productos/21 Productos de software/21.11 Hebra';
  const notePath = '00.00 JDex/21.11 Hebra.md';
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: SETTINGS.jdexFolder,
    folderPaths: [
      '00.00 JDex',
      '20-29 Productos',
      '20-29 Productos/21 Productos de software',
      idPath,
      '20-29 Productos/22 Otra categoría'
    ],
    notePaths: [notePath]
  };
  const index = buildIndex(input);
  const systemNotes: JdexNoteRef[] = [
    { id: 'n-2111', folderId: 'f-jdex', title: '21.11 Hebra', path: notePath }
  ];
  const walk: JdexLibraryWalk = {
    rootFolderId: 'root',
    folderPaths: new Map([
      ['f-jdex', '00.00 JDex'],
      ['f-productos', '20-29 Productos'],
      ['f-cat21', '20-29 Productos/21 Productos de software'],
      ['f-2111', idPath],
      ['f-cat22', '20-29 Productos/22 Otra categoría']
    ]),
    systemFolderPaths: [],
    systemNotes
  };
  return { index, walk };
}

describe('jdexRenameWarning', () => {
  it('renombrar la carpeta cambiando el número avisa de «renumbered»', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'folder-rename', folderId: 'f-2111', newName: '21.12 Hebra' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toEqual({ type: 'renumbered', oldId: '21.11', newId: '21.12' });
    expect(jdexRenameWarningMessage(warning!)).toContain('«21.11»');
    expect(jdexRenameWarningMessage(warning!)).toContain('«21.12»');
  });

  it('renombrar solo el título (mismo número) no avisa', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'folder-rename', folderId: 'f-2111', newName: '21.11 Otro título' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toBeNull();
  });

  it('mover la carpeta a otra categoría avisa de «moved»', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'folder-move', folderId: 'f-2111', newParentId: 'f-cat22' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toEqual({
      type: 'moved',
      id: '21.11',
      from: '20-29 Productos/21 Productos de software',
      to: '20-29 Productos/22 Otra categoría'
    });
    const message = jdexRenameWarningMessage(warning!);
    expect(message).toContain('21 Productos de software');
    expect(message).toContain('22 Otra categoría');
  });

  it('mover la carpeta a la raíz de la biblioteca también avisa (newParentId: null, sin entrada propia en folderPaths)', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'folder-move', folderId: 'f-2111', newParentId: null },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toEqual({
      type: 'moved',
      id: '21.11',
      from: '20-29 Productos/21 Productos de software',
      to: ''
    });
  });

  it('renombrar el título de la nota JDex del ID (mismo número) no avisa', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'note-rename', noteId: 'n-2111', newTitle: '21.11 Otro título' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toBeNull();
  });

  it('renombrar la nota JDex del ID cambiando el número avisa de «renumbered»', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'note-rename', noteId: 'n-2111', newTitle: '21.12 Hebra' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toEqual({ type: 'renumbered', oldId: '21.11', newId: '21.12' });
  });

  it('sin la carpeta o la nota en el recorrido, deja pasar (no la conoce)', () => {
    const { index, walk } = fixture();
    expect(
      jdexRenameWarning(
        { kind: 'folder-rename', folderId: 'no-existe', newName: 'lo que sea' },
        walk,
        index,
        SETTINGS
      )
    ).toBeNull();
    expect(
      jdexRenameWarning(
        { kind: 'note-rename', noteId: 'no-existe', newTitle: 'lo que sea' },
        walk,
        index,
        SETTINGS
      )
    ).toBeNull();
  });

  it('la misma ruta (sin cambio real) deja pasar', () => {
    const { index, walk } = fixture();
    const warning = jdexRenameWarning(
      { kind: 'folder-rename', folderId: 'f-2111', newName: '21.11 Hebra' },
      walk,
      index,
      SETTINGS
    );
    expect(warning).toBeNull();
  });
});
