import { createFakePluginApi } from 'hebra-plugin-api/testing';
import type { PluginFolder, PluginNote, PluginNotesPage, PluginNotesScope } from 'hebra-plugin-api';
import { describe, expect, it } from 'vitest';
import { auditSystem, buildIndex, countProblems, locate } from '../../src/hebra/engine';
import {
  applyJdexNoteChanges,
  jdexAuditNotes,
  loadJdexAuditEntries,
  type JdexNotesState,
  type JdexNotesUpdate,
  buildJdexAuditInput,
  buildJdexAuditNotes,
  buildJdexIndexInput,
  buildJdexInboxSummary,
  firstNonEmptyJdexInbox,
  jdexFolderPaths,
  jdexNotePath,
  jdexResolveFolderId,
  walkJdexLibrary,
  type JdexLibraryPort
} from '../../src/hebra/library-index';
import {
  FAKE_ROOT_FOLDER_ID as ROOT_FOLDER_ID,
  FakeJdexVault,
  fakeFolder,
  fakeNote
} from './support/fakes';

/** `api.markdown` del host falso: `frontmatterRange` es lo único que usa el adaptador. */
const markdown = createFakePluginApi().api.markdown;

// ---- Biblioteca falsa con la FORMA real de un vault de David (áreas, categorías,
// ids con y sin carpeta, cabeceras `AC.X0 ■`, hijos `+`, ceros `.01`/`.09`) ----

let seq = 0;
function folder(name: string, parentId: string | null): PluginFolder {
  seq += 1;
  return fakeFolder(`f${seq}`, parentId, name);
}

function noteRow(id: string, folderId: string, title: string, body = ''): PluginNote {
  return fakeNote(id, folderId, body, { title });
}

function fakeLibrary(notesByFolder: Map<string, PluginNote[]>): JdexLibraryPort {
  return {
    async notesPage(cursor, limit, scope?: PluginNotesScope): Promise<PluginNotesPage> {
      if (!scope || scope.kind !== 'folder') throw new Error('se esperaba un ámbito de carpeta');
      const notes = notesByFolder.get(scope.folderId) ?? [];
      const start = cursor ? notes.findIndex((n) => n.id === cursor) + 1 : 0;
      const page = notes.slice(start, start + limit);
      const hasMore = start + limit < notes.length;
      return {
        items: page.map((n) => ({
          id: n.id,
          title: n.title,
          excerpt: '',
          updatedAt: n.updatedAt,
          favorite: false,
          createdAt: n.createdAt,
          locked: false
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null
      };
    },
    async noteRead(id) {
      for (const notes of notesByFolder.values()) {
        const found = notes.find((n) => n.id === id);
        if (found) return found;
      }
      return null;
    }
  };
}

/** Vault de ejemplo: `00-09 Sistema` con el JDex y el inbox del sistema; `20-29
 *  Productos y servicios / 21 Productos de software propios` con una cabecera, un hijo
 *  `+`, un archivo `.09`, un inbox de categoría y `21.22 JDex Manager` SIN nota (para
 *  que `buildJdexAuditInput` encuentre `folder-without-note`). */
function buildFixture() {
  const sistemaArea = folder('00-09 Sistema', ROOT_FOLDER_ID);
  const sistemaCat = folder('00 Sistema', sistemaArea.id);
  const jdexId = folder('00.00 JDex', sistemaCat.id);
  const sistemaInbox = folder('00.01 Bandeja de entrada', sistemaCat.id);
  const reportsId = folder('00.02 Auditorías', sistemaCat.id);
  const templatesId = folder('00.03 Plantillas', sistemaCat.id);

  const productosArea = folder('20-29 Productos y servicios', ROOT_FOLDER_ID);
  const productosCat = folder('21 Productos de software propios', productosArea.id);
  const catInbox = folder('21.01 Bandeja de entrada', productosCat.id);
  const header = folder('21.10 ■ Herramientas internas', productosCat.id);
  const hebraId = folder('21.11 Hebra', productosCat.id);
  const jdexManagerId = folder('21.22 JDex Manager', productosCat.id);
  const jdexManagerPlus = folder('21.22+ Extensión de JDex Manager', productosCat.id);
  const archiveId = folder('21.09 Archivo', productosCat.id);

  const folders: PluginFolder[] = [
    sistemaArea,
    sistemaCat,
    jdexId,
    sistemaInbox,
    reportsId,
    templatesId,
    productosArea,
    productosCat,
    catInbox,
    header,
    hebraId,
    jdexManagerId,
    jdexManagerPlus,
    archiveId
  ];
  
  const jdexNoteHebra = noteRow(
    'n-hebra',
    jdexId.id,
    '21.11 Hebra',
    [
      '---',
      'jd: 21.11',
      'tipo: id',
      'area: 20-29 Productos y servicios',
      'categoria: 21 Productos de software propios',
      'descripcion: Notas Markdown local-first.',
      '---',
      ''
    ].join('\n')
  );
  // 21.22 JDex Manager NO tiene nota en el JDex: a propósito, para el hallazgo
  // `folder-without-note`.
  const jdexNoteHeader = noteRow(
    'n-header',
    jdexId.id,
    '21.10 ■ Herramientas internas',
    ['---', 'jd: 21.10', 'tipo: cabecera', '---', ''].join('\n')
  );

  const notesByFolder = new Map<string, PluginNote[]>([
    [jdexId.id, [jdexNoteHebra, jdexNoteHeader]],
    [catInbox.id, [noteRow('n-inbox-1', catInbox.id, '2026-09-28 Nota suelta')]],
    [sistemaInbox.id, []],
    [hebraId.id, [noteRow('n-content-hebra', hebraId.id, 'Notas de Hebra')]]
  ]);

  return {
    folders,
    notesByFolder,
    ids: {
      sistemaArea,
      sistemaCat,
      jdexId,
      sistemaInbox,
      reportsId,
      templatesId,
      productosArea,
      productosCat,
      catInbox,
      header,
      hebraId,
      jdexManagerId,
      jdexManagerPlus,
      archiveId
    }
  };
}

describe('jdexFolderPaths', () => {
  it('construye la ruta completa preservando mayúsculas, con NFC', () => {
    const { folders, ids } = buildFixture();
    const paths = jdexFolderPaths(folders, ROOT_FOLDER_ID);
    expect(paths.get(ids.jdexManagerId.id)).toBe(
      '20-29 Productos y servicios/21 Productos de software propios/21.22 JDex Manager'
    );
    expect(paths.get(ids.sistemaArea.id)).toBe('00-09 Sistema');
  });

  it('jdexResolveFolderId es la inversa exacta, sensible a mayúsculas', () => {
    const { folders, ids } = buildFixture();
    const paths = jdexFolderPaths(folders, ROOT_FOLDER_ID);
    const path = paths.get(ids.jdexManagerId.id)!;
    expect(jdexResolveFolderId({ folderPaths: paths, rootFolderId: ROOT_FOLDER_ID }, path)).toBe(ids.jdexManagerId.id);
    expect(jdexResolveFolderId({ folderPaths: paths, rootFolderId: ROOT_FOLDER_ID }, path.toLowerCase())).toBeNull();
    expect(jdexResolveFolderId({ folderPaths: paths, rootFolderId: ROOT_FOLDER_ID }, '')).toBe(ROOT_FOLDER_ID);
  });
});

describe('walkJdexLibrary + buildJdexIndexInput + buildIndex', () => {
  it('arma un JdIndex con áreas, categorías, cabecera, hijo + y ceros .01/.09', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const jdexFolderPath = walk.folderPaths.get(ids.jdexId.id)!;
    const realInput = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(realInput);

    expect(index.areas.map((a) => a.label)).toEqual(
      expect.arrayContaining(['00-09 Sistema', '20-29 Productos y servicios'])
    );
    expect(index.categories.map((c) => c.label)).toEqual(
      expect.arrayContaining(['00 Sistema', '21 Productos de software propios'])
    );

    const jdexManager = index.ids.find((e) => e.id === '21.22');
    expect(jdexManager?.folderPath).toBe(
      '20-29 Productos y servicios/21 Productos de software propios/21.22 JDex Manager'
    );
    expect(jdexManager?.notePath).toBeUndefined(); // sin nota JDex, a propósito.

    const header = index.ids.find((e) => e.id === '21.10');
    expect(header?.label).toBe('21.10 ■ Herramientas internas');

    const plus = index.ids.find((e) => e.id === '21.22+');
    expect(plus?.folderPath).toContain('21.22+ Extensión de JDex Manager');

    const catInbox = index.ids.find((e) => e.id === '21.01');
    expect(catInbox?.folderPath).toContain('21.01 Bandeja de entrada');
    const archive = index.ids.find((e) => e.id === '21.09');
    expect(archive?.folderPath).toContain('21.09 Archivo');

    // Hebra (21.11) tiene nota Y carpeta: el índice fusiona ambas por número.
    const hebra = index.ids.find((e) => e.id === '21.11');
    expect(hebra?.notePath).toBe(jdexFolderPath + '/21.11 Hebra.md');
    expect(hebra?.folderPath).toContain('21.11 Hebra');
  });

  it('systemRoot no vacío deja fuera lo que no cuelga de él', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const productosPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.productosArea.id)!;
    const walk = await walkJdexLibrary(library, folders, productosPath, ROOT_FOLDER_ID);
    expect(walk.systemFolderPaths.every((p) => p.startsWith(productosPath))).toBe(true);
    expect(walk.systemFolderPaths.some((p) => p.includes('Sistema'))).toBe(false);
  });
});

describe('buildJdexAuditNotes + buildJdexAuditInput + auditSystem', () => {
  it('encuentra la carpeta sin nota (21.22) y NO toca notas fuera del JDex', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);

    const notes = await buildJdexAuditNotes(library, markdown, walk, jdexFolderPath);
    // Solo las 2 notas DIRECTAS de la carpeta JDex, nunca la de dentro de Hebra.
    expect(notes.map((n) => n.path).sort()).toEqual(
      [
        jdexFolderPath + '/21.10 ■ Herramientas internas.md',
        jdexFolderPath + '/21.11 Hebra.md'
      ].sort()
    );
    // La de Hebra ya tiene descripción: no lleva `body`.
    const hebraNote = notes.find((n) => n.path.endsWith('21.11 Hebra.md'));
    expect(hebraNote?.frontmatter?.jd).toBe(21.11); // YAML real: número, no texto.
    expect(hebraNote?.body).toBeUndefined();
    // La cabecera no tiene `descripcion`: sí lleva `body` (para proponerla).
    const headerNote = notes.find((n) => n.path.endsWith('Herramientas internas.md'));
    expect(headerNote?.body).toBeDefined();

    const auditInput = buildJdexAuditInput(index, notes, walk, {
      noteWithoutFolderIsFinding: false,
      descriptionIsFinding: true,
      structureNotesAreFindings: false
    });
    const findings = auditSystem(auditInput);
    const folderWithoutNote = findings.find(
      (f) => f.kind === 'folder-without-note' && f.number === '21.22'
    );
    expect(folderWithoutNote).toBeDefined();
    expect(countProblems(findings)).toBeGreaterThan(0);
  });
});

describe('buildJdexInboxSummary + firstNonEmptyJdexInbox', () => {
  it('cuenta las notas directas de cada .01 y elige el primero con elementos', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);

    const summary = buildJdexInboxSummary(index, walk);
    // 00.01 (sistema, vacío) y 21.01 (categoría, con 1 nota).
    expect(summary.folders).toHaveLength(2);
    expect(summary.total).toBe(1);

    const first = firstNonEmptyJdexInbox(summary);
    expect(first?.entry.id).toBe('21.01');
    expect(first?.count).toBe(1);
  });

  it('con todos vacíos, el primero de la lista', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    notesByFolder.set(ids.catInbox.id, []);
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);
    const summary = buildJdexInboxSummary(index, walk);
    expect(summary.total).toBe(0);
    expect(firstNonEmptyJdexInbox(summary)).toBe(summary.folders[0]);
  });
});

describe('jdexNotePath + locate (ruta de la barra de estado)', () => {
  it('da la misma ruta que el índice para la nota JDex de 21.11', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);

    const path = jdexNotePath(walk.folderPaths, { folderId: ids.jdexId.id, title: '21.11 Hebra' });
    expect(path).toBe(jdexFolderPath + '/21.11 Hebra.md');

    const located = locate(index, { jdexFolder: jdexFolderPath }, path!);
    expect(located?.text).toBe('21 Productos de software propios › 21.11 Hebra');
    expect(located?.atNote).toBe(true);
  });

  it('un fichero dentro de la carpeta de un ID da la ruta del ID, no `atNote`', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);

    const contentPath = jdexNotePath(walk.folderPaths, {
      folderId: ids.hebraId.id,
      title: 'Notas de Hebra'
    })!;
    const located = locate(index, { jdexFolder: jdexFolderPath }, contentPath);
    expect(located?.entry.id).toBe('21.11');
    expect(located?.atNote).toBe(false);
    expect(located?.text).toBe('21 Productos de software propios › 21.11 Hebra');
  });

  it('fuera del sistema, null', async () => {
    const { folders, notesByFolder, ids } = buildFixture();
    const library = fakeLibrary(notesByFolder);
    const jdexFolderPath = jdexFolderPaths(folders, ROOT_FOLDER_ID).get(ids.jdexId.id)!;
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: jdexFolderPath });
    const index = buildIndex(input);
    expect(locate(index, { jdexFolder: jdexFolderPath }, 'Notas sueltas/Algo.md')).toBeNull();
  });
});

// ---- Rendimiento: ~3.300 notas repartidas en unos cientos de carpetas de sistema ----

function buildLargeFixture(noteCount: number) {
  const folders: PluginFolder[] = [];
  const notesByFolder = new Map<string, PluginNote[]>();
  let noteSeq = 0;
  // 10 áreas × 10 categorías × 8 ids de contenido = 800 carpetas de sistema.
  for (let area = 0; area <= 90; area += 10) {
    const areaFolder = folder(
      `${String(area).padStart(2, '0')}-${String(area + 9).padStart(2, '0')} Área ${area}`,
      ROOT_FOLDER_ID
    );
    folders.push(areaFolder);
    for (let cat = area + 1; cat <= area + 9; cat += 1) {
      const catFolder = folder(`${String(cat).padStart(2, '0')} Categoría ${cat}`, areaFolder.id);
      folders.push(catFolder);
      for (let id = 11; id <= 91; id += 10) {
        const idNumber = `${String(cat).padStart(2, '0')}.${String(id).padStart(2, '0')}`;
        const idFolder = folder(`${idNumber} Id ${idNumber}`, catFolder.id);
        folders.push(idFolder);
        const notes: PluginNote[] = [];
        const perFolder = Math.ceil(noteCount / (9 * 9 * 9));
        for (let n = 0; n < perFolder; n += 1) {
          noteSeq += 1;
          notes.push(noteRow(`note-${noteSeq}`, idFolder.id, `Nota ${noteSeq}`));
        }
        notesByFolder.set(idFolder.id, notes);
      }
    }
  }
  return { folders, notesByFolder, totalNotes: noteSeq };
}

describe('rendimiento con una biblioteca del tamaño real (~3.300 notas)', () => {
  it('construye el índice completo sin tardar segundos', async () => {
    const { folders, notesByFolder, totalNotes } = buildLargeFixture(3300);
    const library = fakeLibrary(notesByFolder);
    const start = performance.now();
    const walk = await walkJdexLibrary(library, folders, '', ROOT_FOLDER_ID);
    const input = buildJdexIndexInput(walk, { systemRoot: '', jdexFolder: '' });
    const index = buildIndex(input);
    const elapsedMs = performance.now() - start;

    expect(totalNotes).toBeGreaterThanOrEqual(3300);
    expect(walk.systemNotes.length).toBe(totalNotes);
    expect(index.ids.length).toBe(10 * 9 * 9); // 10 áreas × 9 categorías × 9 ids de contenido.
     
    console.log(
      `[jdex perf] ${totalNotes} notas, ${walk.systemFolderPaths.length} carpetas: ${elapsedMs.toFixed(1)} ms`
    );
    expect(elapsedMs).toBeLessThan(2000);
  });
});

// ---- PERF-07: la puesta al día por ids es IGUAL a un recorrido completo ------------
//
// Contra el `vault` en memoria de los tests (`FakeJdexVault`, con jerarquía de carpetas y
// el ciclo de vida de una nota: papelera, archivo, baja, guardado desde fuera), no contra
// un doble a medida: tras cada operación, el recorrido, lo leído de la carpeta JDex y lo
// que se deriva de ello (índice, hallazgos de la auditoría e inbox) tienen que ser, en
// profundidad, lo mismo que sale de reconstruirlo todo desde cero sobre el mismo estado.
//
// En Hebra este bloque corría contra el almacén REAL (`SqliteLibraryEngine` +
// `LocalLibraryPort`). Aquí el almacén es el doble: lo que prueba es el adaptador sobre la
// interfaz `PluginVault`; que el almacén real devuelva lo mismo que el doble (carpeta
// efectiva en el resumen, papelera y archivo, sync e importación) es del test de contrato
// de Hebra, que se queda allí. Las operaciones que la API de plugins no ofrece (archivar,
// restaurar, anclar, purgar, sync, importar) se simulan con los controles del doble.

describe('applyJdexNoteChanges: igual a una reconstrucción completa (vault en memoria)', () => {
  const SYSTEM_ROOT = 'Sistema JD';
  const JDEX_FOLDER = 'Sistema JD/00-09 Sistema/00 Sistema/00.00 JDex';
  const SETTINGS = { systemRoot: SYSTEM_ROOT, jdexFolder: JDEX_FOLDER };
  const AUDIT_OPTIONS = {
    noteWithoutFolderIsFinding: false,
    descriptionIsFinding: true,
    structureNotesAreFindings: false
  };

  /** Nota con título en `# `: lo que escribe cualquiera. */
  function plain(title: string, text = ''): string {
    return `# ${title}\n\n${text}`;
  }

  /** Nota JDex: frontmatter y `title:` (la propiedad que el título prefiere al H1). */
  function jdexBody(jd: string, title: string, extra: string[] = []): string {
    return [
      '---',
      `title: ${title}`,
      `jd: ${jd}`,
      'tipo: id',
      'area: 20-29 Productos',
      'categoria: 21 Productos',
      ...extra,
      '---',
      ''
    ].join('\n');
  }

  function openStore() {
    const vault = new FakeJdexVault();
    const calls = { noteRead: 0, noteSummary: 0, notesPage: 0 };
    // Cuenta lo que JDex le pide al almacén (el almacén sigue siendo el mismo).
    const counted = {
      noteRead: (id: string) => {
        calls.noteRead += 1;
        return vault.noteRead(id);
      },
      noteSummary: (ids: readonly string[]) => {
        calls.noteSummary += 1;
        return vault.noteSummary(ids);
      },
      notesPage: (...args: Parameters<FakeJdexVault['notesPage']>) => {
        calls.notesPage += 1;
        return vault.notesPage(...args);
      }
    };
    return { port: vault, counted, calls };
  }

  type Store = ReturnType<typeof openStore>;

  async function createNote(port: FakeJdexVault, folderId: string, body: string): Promise<string> {
    return (await port.noteCreate({ folderId, body })).id;
  }

  /** Un sistema JDex pequeño y completo, más carpetas FUERA del sistema. */
  async function buildSystem(port: FakeJdexVault) {
    const folderId = async (parent: string | null, name: string) =>
      (await port.folderCreate(parent, name)).id;
    const root = await folderId(null, SYSTEM_ROOT);
    const sistemaArea = await folderId(root, '00-09 Sistema');
    const sistemaCat = await folderId(sistemaArea, '00 Sistema');
    const jdex = await folderId(sistemaCat, '00.00 JDex');
    const productosArea = await folderId(root, '20-29 Productos');
    const productosCat = await folderId(productosArea, '21 Productos');
    const inbox = await folderId(productosCat, '21.01 Bandeja');
    const hebra = await folderId(productosCat, '21.11 Hebra');
    const otro = await folderId(productosCat, '21.12 Otro');
    const templates = await folderId(productosCat, '21.13 Plantillas');
    const fuera = await folderId(null, 'Personal');
    const ids = {
      jdexHebra: await createNote(
        port,
        jdex,
        jdexBody('21.11', '21.11 Hebra', ['descripcion: Notas.'])
      ),
      jdexOtro: await createNote(port, jdex, jdexBody('21.12', '21.12 Otro')),
      inbox: await createNote(port, inbox, plain('Nota suelta', 'cuerpo')),
      contenido: await createNote(port, hebra, plain('Notas de Hebra', 'cuerpo')),
      plantilla: await createNote(port, templates, plain('Plantilla diaria', 'cuerpo')),
      fuera: await createNote(port, fuera, plain('Nota personal', 'cuerpo'))
    };
    return { folders: { root, jdex, inbox, hebra, otro, templates, fuera }, ids };
  }

  /** Todo lo que el módulo deriva de un estado, para compararlo en profundidad. */
  function derived(state: JdexNotesState) {
    const index = buildIndex(buildJdexIndexInput(state.walk, SETTINGS));
    const notes = jdexAuditNotes(state.walk, state.entries, JDEX_FOLDER);
    const findings = auditSystem(buildJdexAuditInput(index, notes, state.walk, AUDIT_OPTIONS));
    return { index, notes, findings, inbox: buildJdexInboxSummary(index, state.walk) };
  }

  async function fullState(port: FakeJdexVault): Promise<JdexNotesState> {
    const walk = await walkJdexLibrary(
      port,
      await port.foldersList(),
      SYSTEM_ROOT,
      port.rootFolderId()
    );
    return { walk, entries: await loadJdexAuditEntries(port, markdown, walk, JDEX_FOLDER) };
  }

  /** Aplica el cambio por la vía incremental sobre `state` y exige que dé lo mismo que
   *  reconstruir desde cero. Devuelve el estado nuevo, lo que resolvió y lo que le pidió
   *  al almacén (solo la vía incremental; la reconstrucción de control no cuenta). */
  async function applyAndCompare(
    store: Store,
    state: JdexNotesState,
    ids: string[]
  ): Promise<{
    state: JdexNotesState;
    update: JdexNotesUpdate;
    used: { noteRead: number; noteSummary: number; notesPage: number };
  }> {
    const before = { ...store.calls };
    const update = await applyJdexNoteChanges(store.counted, markdown, state, ids, SETTINGS);
    const used = {
      noteRead: store.calls.noteRead - before.noteRead,
      noteSummary: store.calls.noteSummary - before.noteSummary,
      notesPage: store.calls.notesPage - before.notesPage
    };
    const next = update.kind === 'updated' ? update.state : state;
    const full = await fullState(store.port);
    expect(next.walk.systemNotes).toEqual(full.walk.systemNotes);
    expect(next.walk).toEqual(full.walk);
    expect(next.entries).toEqual(full.entries);
    expect(derived(next)).toEqual(derived(full));
    return { state: next, update, used };
  }

  it('la base de la comparación: el sistema de prueba da un índice con IDs y hallazgos', async () => {
    const { port } = openStore();
    await buildSystem(port);
    const state = await fullState(port);
    expect(derived(state).index.ids.length).toBeGreaterThan(0);
    expect(derived(state).notes).toHaveLength(2);
    expect(state.walk.systemNotes.map((note) => note.title)).not.toContain('Nota personal');
  });

  it('un guardado de cuerpo fuera de la carpeta JDex no cambia nada ni lee ningún cuerpo', async () => {
    const { port, counted, calls } = openStore();
    const { ids } = await buildSystem(port);
    const state = await fullState(port);
    for (const id of [ids.fuera, ids.contenido, ids.inbox]) {
      port.saveElsewhere(id, plain((await port.noteRead(id))!.title, `otro cuerpo ${id}`));
    }
    calls.noteRead = calls.notesPage = 0;
    const update = await applyJdexNoteChanges(
      counted,
      markdown,
      state,
      [ids.fuera, ids.contenido, ids.inbox],
      SETTINGS
    );
    expect(update).toEqual({ kind: 'unchanged' });
    // Una `noteSummary` (sin cuerpo) y NADA más: ni páginas ni lecturas de cuerpo.
    expect(calls).toEqual({ noteRead: 0, noteSummary: 1, notesPage: 0 });
    const full = await fullState(port);
    expect(derived(state)).toEqual(derived(full));
  });

  it('guardados: título de una nota del sistema y de la carpeta JDex, y frontmatter JDex', async () => {
    const store = openStore();
    const { port } = store;
    const { ids } = await buildSystem(port);
    let state = await fullState(port);

    // Título de una nota de contenido: cambia su ruta, no se lee ningún cuerpo.
    port.saveElsewhere(ids.contenido, plain('Notas de Hebra, revisadas', 'cuerpo'));
    let step = await applyAndCompare(store, state, [ids.contenido]);
    expect(step.update.kind).toBe('updated');
    expect(step.used).toEqual({ noteRead: 0, noteSummary: 1, notesPage: 0 });
    state = step.state;

    // Frontmatter JDex: cambia lo que se lee de la nota, una sola lectura.
    port.saveElsewhere(ids.jdexHebra, jdexBody('21.11', '21.11 Hebra', ['area: otra']));
    step = await applyAndCompare(store, state, [ids.jdexHebra]);
    expect(step.update.kind).toBe('updated');
    expect(step.used).toEqual({ noteRead: 1, noteSummary: 1, notesPage: 0 });
    state = step.state;

    // Título de una nota JDex (vive en su frontmatter): cambia la ruta y el cuerpo.
    port.saveElsewhere(ids.jdexOtro, jdexBody('21.12', '21.12 Otro renombrado'));
    step = await applyAndCompare(store, state, [ids.jdexOtro]);
    expect(step.update.kind).toBe('updated');
    state = step.state;
    expect(state.walk.systemNotes.map((note) => note.title)).toContain('21.12 Otro renombrado');
  });

  it('alta, baja (papelera, archivo, restaurar, purgar) y movimientos dentro y fuera del sistema', async () => {
    const store = openStore();
    const { port } = store;
    const { folders, ids } = await buildSystem(port);
    let state = await fullState(port);
    const run = async (...changed: string[]) => {
      const step = await applyAndCompare(store, state, changed);
      state = step.state;
      return step.update.kind;
    };

    // Alta: una nota de contenido y una nota JDex.
    const nuevo = await createNote(port, folders.hebra, plain('Nota nueva', 'x'));
    expect(await run(nuevo)).toBe('updated');
    const nuevaJdex = await createNote(port, folders.jdex, jdexBody('21.13', '21.13 Plantillas'));
    expect(await run(nuevaJdex)).toBe('updated');
    // Alta fuera del sistema: nada.
    const personal = await createNote(port, folders.fuera, plain('Otra personal'));
    expect(await run(personal)).toBe('unchanged');

    // Papelera y restaurar.
    await port.noteTrash(ids.contenido);
    expect(await run(ids.contenido)).toBe('updated');
    port.setTrashed(ids.contenido, false);
    expect(await run(ids.contenido)).toBe('updated');
    // Archivo y desarchivar (una JDex).
    port.setArchived(ids.jdexOtro, true);
    expect(await run(ids.jdexOtro)).toBe('updated');
    port.setArchived(ids.jdexOtro, false);
    expect(await run(ids.jdexOtro)).toBe('updated');
    // Anclar no cambia nada de lo que se indexa (ocultar no existe en la API de plugins).
    port.setFavorite(ids.contenido, true);
    port.setFavorite(ids.inbox, true);
    expect(await run(ids.contenido, ids.inbox)).toBe('unchanged');

    // Mover: dentro del sistema, hacia fuera y desde fuera.
    await port.noteMove(ids.contenido, folders.otro);
    expect(await run(ids.contenido)).toBe('updated');
    await port.noteMove(ids.contenido, folders.fuera);
    expect(await run(ids.contenido)).toBe('updated');
    await port.noteMove(ids.fuera, folders.hebra);
    expect(await run(ids.fuera)).toBe('updated');
    // Una nota JDex sale de la carpeta JDex (deja de ser JDex) y vuelve.
    await port.noteMove(ids.jdexOtro, folders.inbox);
    expect(await run(ids.jdexOtro)).toBe('updated');
    await port.noteMove(ids.jdexOtro, folders.jdex);
    expect(await run(ids.jdexOtro)).toBe('updated');

    // Plantilla (una nota más de una carpeta del sistema): cuerpo y título.
    port.saveElsewhere(ids.plantilla, plain('Plantilla semanal', '{{date}}'));
    expect(await run(ids.plantilla)).toBe('updated');

    // Texto opaco en la carpeta JDex (sin frontmatter): se lee igual que en un recorrido
    // completo.
    port.saveElsewhere(ids.jdexHebra, 'texto opaco sin frontmatter');
    expect(await run(ids.jdexHebra)).toBe('updated');

    // Purgar una nota.
    await port.noteTrash(nuevo);
    port.purge(nuevo);
    expect(await run(nuevo)).toBe('updated');
  });

  it('una nota protegida (sin cuerpo para el plugin) en la carpeta JDex: se lee igual que en un recorrido completo', async () => {
    const store = openStore();
    const { port } = store;
    const { ids } = await buildSystem(port);
    const state = await fullState(port);
    port.setLocked(ids.jdexHebra, true);
    // La vía incremental y la completa ven lo mismo: sin frontmatter y sin cuerpo que
    // proponer; el resto del sistema no se mueve.
    const step = await applyAndCompare(store, state, [ids.jdexHebra]);
    expect(step.update.kind).toBe('updated');
    const locked = [...step.state.entries.values()].find((entry) => entry.frontmatter === null);
    expect(locked).toMatchObject({ frontmatter: null, body: undefined });
  });

  it('importación y sync: pocas notas se resuelven por ids; muchas piden reconstruir', async () => {
    const store = openStore();
    const { port } = store;
    const { folders } = await buildSystem(port);
    let state = await fullState(port);

    // Sync: una nota remota llega a una carpeta del sistema.
    port.seedNote(
      fakeNote('remota-1', folders.hebra, plain('Nota remota', 'del otro dispositivo'))
    );
    let step = await applyAndCompare(store, state, ['remota-1']);
    expect(step.update.kind).toBe('updated');
    state = step.state;

    // Importación de unas pocas notas.
    const importedIds = ['imp-1', 'imp-2', 'imp-3'];
    importedIds.forEach((id, n) => {
      port.seedNote(fakeNote(id, folders.otro, plain(`Importada ${n}`, 'x')));
    });
    step = await applyAndCompare(store, state, importedIds);
    expect(step.update.kind).toBe('updated');
    state = step.state;

    // Más ids que una `noteSummary`: una importación masiva reconstruye entero.
    const many = Array.from({ length: 250 }, (_, n) => `masiva-${n}`);
    expect(await applyJdexNoteChanges(port, markdown, state, many, SETTINGS)).toEqual({
      kind: 'rebuild',
      reason: 'too-many-ids'
    });
  });

  it('una nota que cae en una carpeta que el recorrido no conoce pide reconstruir', async () => {
    const { port } = openStore();
    const { folders } = await buildSystem(port);
    const state = await fullState(port);
    const reciente = (await port.folderCreate(folders.root, 'Creada después')).id;
    const id = await createNote(port, reciente, plain('En la carpeta nueva'));
    expect(await applyJdexNoteChanges(port, markdown, state, [id], SETTINGS)).toEqual({
      kind: 'rebuild',
      reason: 'unknown-folder'
    });
  });

  it('una nota JDex que no cambió se relee (el resumen de la API no trae el SHA) pero NO cuenta como cambio', async () => {
    // Cambio de la API respecto al almacén de Hebra: `PluginNoteSummary` no lleva
    // `bodySha256`, así que no se puede decidir sin leer. En Hebra esta prueba exigía
    // `noteRead: 0`; ahora exige la lectura Y que, al ver el mismo SHA, el resultado sea
    // `unchanged` (nada de reconstrucciones ni repintados de más).
    const { port, counted, calls } = openStore();
    const { ids } = await buildSystem(port);
    const state = await fullState(port);
    calls.noteRead = 0;
    const update = await applyJdexNoteChanges(counted, markdown, state, [ids.jdexHebra], SETTINGS);
    expect(update).toEqual({ kind: 'unchanged' });
    expect(calls.noteRead).toBe(1);
  });
});
