import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { buildIndex, selectCreationSystem, DEFAULT_SETTINGS, type IndexInput, type JdexManagerSettings } from '../../src/hebra/engine';
import {
  createJdexArea,
  createJdexCategory,
  createJdexChild,
  createJdexHeader,
  createJdexId,
  resolveJdexTemplate
} from '../../src/hebra/jdex-create-write';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeNote } from './support/fakes';

// `withTitle` del host falso del paquete (aproxima el de Hebra, que cubre su propio test).
const markdown = createFakePluginApi().api.markdown;

const JDEX_FOLDER_PATH = '00.00 JDex';

/** Sistema mínimo bajo `20-29 Productos/21 Productos de software`: un ID con nota y
 *  carpeta (`21.11 Hebra`) y una carpeta SIN nota (`21.22 JDex Manager`, para probar
 *  «número ocupado por carpeta»). */
function baseFolderPaths(): string[] {
  return [
    JDEX_FOLDER_PATH,
    '20-29 Productos',
    '20-29 Productos/21 Productos de software',
    '20-29 Productos/21 Productos de software/21.11 Hebra',
    '20-29 Productos/21 Productos de software/21.22 JDex Manager'
  ];
}

function baseNotePaths(): string[] {
  return [
    `${JDEX_FOLDER_PATH}/20-29 Productos.md`,
    `${JDEX_FOLDER_PATH}/21 Productos de software.md`,
    `${JDEX_FOLDER_PATH}/21.11 Hebra.md`
  ];
}

function buildWalkAndIndex(extraNoteRefs: JdexNoteRef[] = []) {
  const folderPaths = new Map<string, string>([
    ['f-jdex', JDEX_FOLDER_PATH],
    ['f-area20', '20-29 Productos'],
    ['f-cat21', '20-29 Productos/21 Productos de software'],
    ['f-id2111', '20-29 Productos/21 Productos de software/21.11 Hebra'],
    ['f-id2122', '20-29 Productos/21 Productos de software/21.22 JDex Manager']
  ]);
  const systemNotes: JdexNoteRef[] = [
    {
      id: 'n-area20',
      folderId: 'f-jdex',
      title: '20-29 Productos',
      path: `${JDEX_FOLDER_PATH}/20-29 Productos.md`
    },
    {
      id: 'n-cat21',
      folderId: 'f-jdex',
      title: '21 Productos de software',
      path: `${JDEX_FOLDER_PATH}/21 Productos de software.md`
    },
    {
      id: 'n-id2111',
      folderId: 'f-jdex',
      title: '21.11 Hebra',
      path: `${JDEX_FOLDER_PATH}/21.11 Hebra.md`
    },
    ...extraNoteRefs
  ];
  const walk: JdexLibraryWalk = {
    rootFolderId: 'root',
    folderPaths,
    systemFolderPaths: [...folderPaths.values()],
    systemNotes
  };
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: JDEX_FOLDER_PATH,
    folderPaths: baseFolderPaths(),
    notePaths: [...baseNotePaths(), ...extraNoteRefs.map((n) => n.path)]
  };
  const index = buildIndex(input);
  return { walk, index };
}

function baseSettings(overrides: Partial<JdexManagerSettings> = {}): JdexManagerSettings {
  return { ...DEFAULT_SETTINGS, jdexFolder: JDEX_FOLDER_PATH, systemRoot: '', ...overrides };
}

describe('createJdexId', () => {
  it('rechaza un ID ocupado por CARPETA (21.22, sin nota) sin escribir nada', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    const category = index.categories.find((c) => c.number === '21')!;
    await expect(
      createJdexId(library, markdown, walk, baseSettings(), index, {
        category,
        id: '21.22',
        title: 'Otra cosa',
        createFolder: false
      })
    ).rejects.toThrow(/Ya lo usa/);
    expect((await library.foldersList())).toHaveLength(0);
  });

  it('crea la nota con la plantilla por defecto y la deja en la carpeta JDex', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    const category = index.categories.find((c) => c.number === '21')!;
    const outcome = await createJdexId(library, markdown, walk, baseSettings(), index, {
      category,
      id: '21.23',
      title: 'Nuevo módulo',
      createFolder: false
    });
    expect(outcome.note.title).toBe('21.23 Nuevo módulo');
    expect(outcome.note.body).toContain('jd: "21.23"');
    expect(outcome.note.body).toContain('tipo: id');
    expect(outcome.note.body).toContain('# 21.23 Nuevo módulo');
    expect(outcome.folderPath).toBeNull();
  });

  it('con «crear también la carpeta», la crea dentro de la categoría', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    library.seedFolder({
      id: 'f-cat21',
      parentId: 'f-area20',
      name: '21 Productos de software',
      createdAt: 0,
      updatedAt: 0
    });
    const category = index.categories.find((c) => c.number === '21')!;
    const outcome = await createJdexId(library, markdown, walk, baseSettings(), index, {
      category,
      id: '21.23',
      title: 'Nuevo módulo',
      createFolder: true
    });
    expect(outcome.folderPath).toBe('20-29 Productos/21 Productos de software/21.23 Nuevo módulo');
    expect(outcome.folderNotice).toBeNull();
    const folders = (await library.foldersList());
    expect(folders.some((f) => f.name === '21.23 Nuevo módulo' && f.parentId === 'f-cat21')).toBe(
      true
    );
  });

  it('avisa (sin lanzar) cuando la categoría no tiene carpeta y se pidió crearla', async () => {
    // Índice sin carpetas: la categoría solo existe como nota JDex (`category.path`
    // vacío).
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map([['f-jdex', JDEX_FOLDER_PATH]]),
      systemFolderPaths: [JDEX_FOLDER_PATH],
      systemNotes: [
        {
          id: 'n-cat21',
          folderId: 'f-jdex',
          title: '21 Productos de software',
          path: `${JDEX_FOLDER_PATH}/21 Productos de software.md`
        }
      ]
    };
    const index = buildIndex({
      systemRoot: '',
      jdexFolder: JDEX_FOLDER_PATH,
      folderPaths: [JDEX_FOLDER_PATH],
      notePaths: [`${JDEX_FOLDER_PATH}/21 Productos de software.md`]
    });
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    const category = index.categories.find((c) => c.number === '21')!;
    const outcome = await createJdexId(library, markdown, walk, baseSettings(), index, {
      category,
      id: '21.11',
      title: 'Nuevo módulo',
      createFolder: true
    });
    expect(outcome.folderPath).toBeNull();
    expect(outcome.folderNotice).toMatch(/no tiene carpeta/);
  });
});

describe('resolveJdexTemplate', () => {
  it('el sufijo de categoría gana sobre la plantilla general', async () => {
    const folderPaths = new Map<string, string>([
      ['f-templates', '00.03 Plantillas'],
      ['f-jdex', JDEX_FOLDER_PATH]
    ]);
    const generalId = 'n-template-general';
    const scopedId = 'n-template-scoped';
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths,
      systemFolderPaths: [...folderPaths.values()],
      systemNotes: [
        {
          id: generalId,
          folderId: 'f-templates',
          title: 'JDex - id',
          path: '00.03 Plantillas/JDex - id.md'
        },
        {
          id: scopedId,
          folderId: 'f-templates',
          title: 'JDex - id - 21',
          path: '00.03 Plantillas/JDex - id - 21.md'
        }
      ]
    };
    const library = new FakeJdexVault();
    library.seedNote(fakeNote(generalId, 'f-templates', '# General {{title}}'));
    library.seedNote(fakeNote(scopedId, 'f-templates', '# Con sufijo de categoría {{title}}'));
    const settings = baseSettings({ templatesFolder: '00.03 Plantillas' });
    const template = await resolveJdexTemplate(library, walk, settings, 'id', { category: '21' });
    expect(template).toContain('Con sufijo de categoría');
  });

  it('sin plantilla del usuario, cae en la del motor (BUILTIN_TEMPLATES)', async () => {
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map(),
      systemFolderPaths: [],
      systemNotes: []
    };
    const library = new FakeJdexVault();
    const template = await resolveJdexTemplate(library, walk, baseSettings(), 'id');
    expect(template).toContain('jd: "{{id}}"');
  });
});

describe('createJdexCategory', () => {
  it('con los ceros marcados, crea también el inbox y el archivo', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    library.seedFolder({
      id: 'f-area20',
      parentId: null,
      name: '20-29 Productos',
      createdAt: 0,
      updatedAt: 0
    });
    const area = index.areas.find((a) => a.number === 20)!;
    const outcome = await createJdexCategory(library, markdown, walk, baseSettings(), index, {
      area,
      category: '22',
      title: 'Otra categoría',
      createFolder: true,
      createInbox: true,
      createArchive: true
    });
    expect(outcome.folderPath).toBe('20-29 Productos/22 Otra categoría');
    // nota-1: la categoría; nota-2 y nota-3: inbox y archivo (orden de `createJdexCategory`).
    const created = await Promise.all([1, 2, 3].map((n) => library.noteRead(`fake-note-${n}`)));
    const titles = created.filter((n) => n !== null).map((n) => n.title);
    expect(titles).toContain('22.01 Inbox de la categoría 22');
    expect(titles).toContain('22.09 Archivo de la categoría 22');
  });
});

describe('createJdexArea', () => {
  it('con la categoría de gestión marcada, la crea dentro del área', async () => {
    const { walk } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    const outcome = await createJdexArea(library, markdown, walk, baseSettings(), {
      area: 30,
      title: 'Área nueva',
      createFolder: true,
      createManagementCategory: true
    });
    expect(outcome.folderPath).toBe('30-39 Área nueva');
    const managementNote = await library.noteRead('fake-note-2');
    expect(managementNote?.title).toBe('30 Gestión del área 30-39');
  });
});

describe('createJdexHeader', () => {
  it('la nota lleva el título con ■ y los marcadores de hijos', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    const category = index.categories.find((c) => c.number === '21')!;
    const outcome = await createJdexHeader(library, markdown, walk, baseSettings(), index, {
      category,
      id: '21.20',
      title: 'Nueva cabecera',
      emoji: ''
    });
    expect(outcome.note.title).toBe('21.20 ■ Nueva cabecera');
    expect(outcome.note.body).toContain('<!-- jdex:hijos -->');
    expect(outcome.note.body).toContain('<!-- /jdex:hijos -->');
  });
});

describe('createJdexChild', () => {
  it('el número es fijo, `${padre.id}+`, y enlaza al padre', async () => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({
      id: 'f-jdex',
      parentId: null,
      name: '00.00 JDex',
      createdAt: 0,
      updatedAt: 0
    });
    const parent = index.ids.find((e) => e.id === '21.11')!;
    const outcome = await createJdexChild(library, markdown, walk, baseSettings(), index, {
      parent,
      title: 'Extensión',
      createFolder: false
    });
    expect(outcome.note.title).toBe('21.11+ Extensión');
    expect(outcome.note.body).toContain('[[21.11 Hebra]]');
  });
});


describe('última comprobación de número en la biblioteca viva', () => {
  it.each(['id', 'header', 'child'] as const)('rechaza %s llegado tras el snapshot aunque su título sea distinto', async (kind) => {
    const { walk, index } = buildWalkAndIndex();
    const library = new FakeJdexVault();
    library.seedFolder({ id: 'f-jdex', parentId: null, name: JDEX_FOLDER_PATH, createdAt: 0, updatedAt: 0 });
    const category = index.categories.find((entry) => entry.number === '21')!;
    const parent = index.ids.find((entry) => entry.id === '21.11')!;
    const occupied = kind === 'id' ? '21.23 Other' : kind === 'header' ? '21.20 ■ Other' : '21.11+ Child #tag';
    await library.noteCreate({ folderId: 'f-jdex', body: `# ${occupied}` });
    const create = (free: boolean) => kind === 'id'
      ? createJdexId(library, markdown, walk, baseSettings(), index, { category, id: free ? '21.24' : '21.23', title: 'Mine', createFolder: false })
      : kind === 'header'
        ? createJdexHeader(library, markdown, walk, baseSettings(), index, { category, id: free ? '21.30' : '21.20', title: 'Mine', emoji: '' })
        : createJdexChild(library, markdown, walk, baseSettings(), index, { parent, title: free ? 'Sibling' : 'Child', createFolder: false });
    await expect(create(false)).rejects.toThrow(/Ya lo usa|Ya hay un hijo/);
    expect((await library.notesPage(null, 200, { kind: 'folder', folderId: 'f-jdex' })).items).toHaveLength(1);
    await create(true);
    expect((await library.notesPage(null, 200, { kind: 'folder', folderId: 'f-jdex' })).items).toHaveLength(2);
  });
});


it('crea D01 en andamiaje físico default conservando las etiquetas del área y categoría', async () => {
  const { walk, index } = buildWalkAndIndex();
  const library = new FakeJdexVault();
  library.seedFolder({ id: 'f-jdex', parentId: null, name: JDEX_FOLDER_PATH, createdAt: 0, updatedAt: 0 });
  const category = selectCreationSystem(index, 'D01').categories.find((entry) => entry.number === '21')!;
  const outcome = await createJdexId(library, markdown, walk, baseSettings({ systemId: 'D01', prefixNamesWithSystem: true }), index, { category, id: '21.11', title: 'Own ID', createFolder: false });
  expect(outcome.note.title).toBe('D01.21.11 Own ID');
  expect(outcome.note.body).toContain('area: "20-29 Productos"');
  expect(outcome.note.body).toContain('categoria: "21 Productos de software"');
});
