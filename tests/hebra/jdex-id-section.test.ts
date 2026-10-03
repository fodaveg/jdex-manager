import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import { loadJdexIdSection, type JdexIdSectionLibrary } from '../../src/hebra/jdex-id-section';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';
import { fakeNote } from './support/fakes';

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

function fakeLibrary(): JdexIdSectionLibrary {
  return {
    async noteRead(id: string) {
      if (id === 'n-hebra') {
        return fakeNote(
          id,
          'f-jdex',
          ['---', 'jd: 21.11', 'descripcion: Notas locales.', '---', ''].join('\n'),
          { title: '21.11 Hebra' }
        );
      }
      return null;
    },
    async notesPage() {
      return {
        items: [
          {
            id: 'n-content',
            title: 'Notas de Hebra',
            excerpt: '',
            updatedAt: 100,
            createdAt: 0,
            favorite: false,
            locked: false
          }
        ],
        nextCursor: null
      };
    },
    async filesPage() {
      return {
        items: [
          {
            id: 'f1',
            folderId: 'f-hebra',
            name: 'captura.png',
            sha256: 'sha',
            byteLength: 1,
            mime: 'image/png',
            createdAt: 0,
            updatedAt: 200,
            trashedAt: null
          }
        ],
        nextCursor: null
      };
    }
  };
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
    expect(data.children).toEqual([]);
  });
});
