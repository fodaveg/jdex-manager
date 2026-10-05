// @vitest-environment happy-dom
//
// `activateJdex(api)` de JDex Manager sobre el host falso del paquete
// (`createFakePluginApi`, que registra comandos, vistas, paneles y piezas de la barra),
// con diálogos y avisos montados de verdad en el DOM (`support/fakes.ts`): lo que se
// registra tiene que verse con la forma de `HebraPluginApi` y deshacerse con la limpieza
// que devuelve `activate`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HebraPluginApi,
  PluginActiveNote,
  PluginFolder,
  PluginNote,
  PluginNoteSummary,
  PluginNoteTitleRenamedEvent,
  PluginNotesChange,
  PluginNotesPage,
  PluginNotesScope,
  PluginVault
} from 'hebra-plugin-api';
import {
  JDEX_AUDIT_VIEW_ID,
  JDEX_COMMAND_AUDIT,
  JDEX_COMMAND_LOCATE,
  JDEX_COMMAND_TOGGLE,
  JDEX_STATUS_AUDIT_ID,
  JDEX_STATUS_INBOX_ID,
  JDEX_STATUS_PATH_ID,
  activateJdex
} from '../../src/hebra/jdex-runtime';
import {
  FAKE_ROOT_FOLDER_ID as ROOT_FOLDER_ID,
  createJdexTestApi,
  fakeFolder,
  fakeNote
} from './support/fakes';

let seq = 0;
function folder(name: string, parentId: string | null): PluginFolder {
  seq += 1;
  return fakeFolder(`f${seq}`, parentId, name);
}

function noteRow(id: string, folderId: string, title: string, body = ''): PluginNote {
  return fakeNote(id, folderId, body, { title });
}

/** Sistema mínimo: `00-09/00/00.00 JDex` con una nota JDex de `21.11`, y `20-29
 *  Productos/21 Productos/21.11 Hebra` con una nota de contenido y `21.22 JDex Manager`
 *  SIN nota (para tener al menos un hallazgo) y un inbox `21.01` con una nota. */
function buildFixture() {
  const sistemaArea = folder('00-09 Sistema', ROOT_FOLDER_ID);
  const sistemaCat = folder('00 Sistema', sistemaArea.id);
  const jdexId = folder('00.00 JDex', sistemaCat.id);
  const productosArea = folder('20-29 Productos y servicios', ROOT_FOLDER_ID);
  const productosCat = folder('21 Productos de software propios', productosArea.id);
  const catInbox = folder('21.01 Bandeja de entrada', productosCat.id);
  const hebraId = folder('21.11 Hebra', productosCat.id);
  const jdexManagerId = folder('21.22 JDex Manager', productosCat.id);

  const folders: PluginFolder[] = [
    sistemaArea,
    sistemaCat,
    jdexId,
    productosArea,
    productosCat,
    catInbox,
    hebraId,
    jdexManagerId
  ];

  const jdexNoteHebra = noteRow(
    'n-hebra',
    jdexId.id,
    '21.11 Hebra',
    ['---', 'jd: 21.11', 'tipo: id', 'descripcion: Notas Markdown local-first.', '---', ''].join(
      '\n'
    )
  );
  const hebraContentNote = noteRow('n-content-hebra', hebraId.id, 'Notas de Hebra');
  const inboxNote = noteRow('n-inbox-1', catInbox.id, '2026-09-28 Nota suelta');

  const notesByFolder = new Map<string, PluginNote[]>([
    [jdexId.id, [jdexNoteHebra]],
    [hebraId.id, [hebraContentNote]],
    [catInbox.id, [inboxNote]]
  ]);

  return { folders, notesByFolder, ids: { jdexId, hebraId, jdexManagerId, catInbox } };
}

/** Lo que el módulo le pide al almacén (PERF-07) y una compuerta para hacer lenta una
 *  lectura: `holdNoteRead` detiene el PRIMER `noteRead` tras haber leído su fila (el
 *  recorrido de carpetas ya terminó, con el estado de ese momento). */
interface PortProbe {
  calls: { notesPage: number; noteRead: number; noteSummary: number };
  holdNoteRead: (() => Promise<void>) | null;
  /** Hace fallar `notesPage` (el recorrido) o `noteSummary` (la puesta al día por ids). */
  failNotesPage?: boolean;
  /** `notesPage` espera a esta promesa y después falla (una lectura en vuelo que acaba mal). */
  gateNotesPage?: Promise<void>;
  failNoteSummary?: boolean;
  /** `notesPage` espera a esta promesa y después SIGUE bien (una lectura en vuelo que acaba
   *  con éxito). Solo la primera vez: la compuerta se consume. */
  holdNotesPage?: Promise<void> | null;
}

function fakeLibraryPort(
  notesByFolder: Map<string, PluginNote[]>,
  probe: PortProbe,
  folders: () => PluginFolder[]
): PluginVault {
  function find(id: string): PluginNote | null {
    for (const notes of notesByFolder.values()) {
      const found = notes.find((n) => n.id === id);
      if (found) return found;
    }
    return null;
  }
  return {
    libraryId: () => 'lib-1',
    rootFolderId: () => ROOT_FOLDER_ID,
    async foldersList() {
      return folders().map((entry) => ({ ...entry }));
    },
    async notesPage(
      cursor: string | null,
      limit: number,
      scope?: PluginNotesScope
    ): Promise<PluginNotesPage> {
      probe.calls.notesPage += 1;
      if (probe.gateNotesPage) {
        await probe.gateNotesPage;
        throw new Error('almacén caído (notesPage, en vuelo)');
      }
      if (probe.holdNotesPage) {
        const hold = probe.holdNotesPage;
        probe.holdNotesPage = null;
        await hold;
      }
      if (probe.failNotesPage) throw new Error('almacén caído (notesPage)');
      if (!scope || scope.kind !== 'folder') throw new Error('se esperaba ámbito de carpeta');
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
    async noteRead(id: string) {
      probe.calls.noteRead += 1;
      const row = find(id);
      const hold = probe.holdNoteRead;
      if (hold) {
        probe.holdNoteRead = null;
        await hold();
      }
      return row;
    },
    async noteSummary(ids: readonly string[]): Promise<PluginNoteSummary[]> {
      probe.calls.noteSummary += 1;
      if (probe.failNoteSummary) throw new Error('almacén caído (noteSummary)');
      // Doble de un host 1.0.0: el resumen no trae `bodySha256` ni `revision`.
      return ids.flatMap((id): PluginNoteSummary[] => {
        const row = find(id);
        return row
          ? [
              {
                id: row.id,
                title: row.title,
                excerpt: '',
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                favorite: false,
                locked: false,
                folderId: row.folderId,
                trashedAt: row.trashedAt,
                archivedAt: row.archivedAt
              } as unknown as PluginNoteSummary
            ]
          : [];
      });
    }
  } as unknown as PluginVault;
}

async function setup(fixture: ReturnType<typeof buildFixture>, settings?: unknown) {
  const probe: PortProbe = {
    calls: { notesPage: 0, noteRead: 0, noteSummary: 0 },
    holdNoteRead: null
  };
  let currentFolders: PluginFolder[] = fixture.folders;
  const port = fakeLibraryPort(fixture.notesByFolder, probe, () => currentFolders);
  const { api, fake, workspace } = await createJdexTestApi({ vault: port, settings });
  /** Lo que registra el plugin, con los nombres que usaba el registro de Hebra. */
  const registry = {
    statusBarItems: () => fake.recorded.statusBarItems,
    commands: () => fake.recorded.commands,
    views: () => fake.recorded.views,
    settingsPanels: () => fake.recorded.settingsPanels
  };
  const context = {
    api,
    selectFolder: workspace.selectFolder,
    openNoteById: workspace.openNote,
    folders: () => currentFolders
  };

  return {
    api,
    workspace,
    registry,
    context,
    probe,
    /** Como Hebra ante un `library-changed` de notas. */
    fireNotesChange: (event: PluginNotesChange) => workspace.emitNotes(event),
    setActiveNote: (note: PluginActiveNote | null) => workspace.setActiveNote(note),
    setFolders: (folders: PluginFolder[]) => {
      currentFolders = folders;
      workspace.emitFolders(folders);
    },
    /** Lote 5: como Hebra tras guardar el título de una nota. */
    fireNoteTitleRenamed: (event: PluginNoteTitleRenamedEvent) =>
      workspace.emitTitleRenamed(event)
  };
}

/** `activateJdex` con la forma que tenía el módulo compilado, para que las pruebas se lean
 *  igual: `jdexRuntimeExport(context).activate(host)`. */
function jdexRuntimeExport(context: { api: HebraPluginApi }) {
  return { activate: (_host?: unknown) => activateJdex(context.api) };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

beforeEach(() => {
  seq = 0;
});

describe('activate', () => {
  it('registra las piezas de la barra, los tres comandos y la vista de auditoría', async () => {
    const fixture = buildFixture();
    const { registry, context } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();

    const statusIds = registry.statusBarItems().map((item) => item.id);
    expect(statusIds).toEqual(expect.arrayContaining([JDEX_STATUS_AUDIT_ID, JDEX_STATUS_INBOX_ID]));
    // 21.22 no tiene nota (y tampoco el 00.00 ni el 21.01, en este fixture mínimo): al
    // menos un hallazgo, tono de aviso.
    const audit = registry.statusBarItems().find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    expect(audit.text).toMatch(/^JD: [1-9]\d*$/);
    expect(audit.tone).toBe('warning');
    expect(audit.icon).toBe('circle-check');
    // 21.01 tiene 1 nota directa.
    const inbox = registry.statusBarItems().find((item) => item.id === JDEX_STATUS_INBOX_ID)!;
    expect(inbox.text).toBe('Inbox: 1');

    const commandIds = registry.commands().map((c) => c.id);
    expect(commandIds).toEqual(
      expect.arrayContaining([JDEX_COMMAND_LOCATE, JDEX_COMMAND_TOGGLE, JDEX_COMMAND_AUDIT])
    );

    expect(registry.views().map((v) => v.id)).toContain(JDEX_AUDIT_VIEW_ID);
    expect(registry.views().find((v) => v.id === JDEX_AUDIT_VIEW_ID)?.icon).toBe('circle-check');
    expect(registry.settingsPanels()).toHaveLength(1);
  });

  it('sin nota activa, no hay pieza de ruta; con una nota del sistema, sí', async () => {
    const fixture = buildFixture();
    const { registry, context, setActiveNote } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();

    expect(
      registry.statusBarItems().find((item) => item.id === JDEX_STATUS_PATH_ID)
    ).toBeUndefined();

    setActiveNote({
      id: 'n-content-hebra',
      folderId: fixture.ids.hebraId.id,
      title: 'Notas de Hebra'
    });
    const path = registry.statusBarItems().find((item) => item.id === JDEX_STATUS_PATH_ID);
    expect(path?.text).toBe('21 Productos de software propios › 21.11 Hebra');

    // Una nota fuera del sistema: la pieza desaparece.
    setActiveNote({ id: 'n-otra', folderId: ROOT_FOLDER_ID, title: 'Nota suelta' });
    expect(
      registry.statusBarItems().find((item) => item.id === JDEX_STATUS_PATH_ID)
    ).toBeUndefined();
  });

  it('«JDex: alternar nota y carpeta» abre la carpeta desde la nota JDex', async () => {
    const fixture = buildFixture();
    const { registry, context, setActiveNote } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();
    setActiveNote({ id: 'n-hebra', folderId: fixture.ids.jdexId.id, title: '21.11 Hebra' });

    const toggle = registry.commands().find((c) => c.id === JDEX_COMMAND_TOGGLE)!;
    void toggle.run();
    expect(context.selectFolder).toHaveBeenCalledWith(fixture.ids.hebraId.id);
  });

  it('el diálogo de auditoría enseña el hallazgo de 21.22 y abre su carpeta al pulsar', async () => {
    const fixture = buildFixture();
    const { registry, context } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();

    const view = registry.views().find((v) => v.id === JDEX_AUDIT_VIEW_ID)!;
    const el = document.createElement('div');
    view.mount(el);
    expect(el.textContent).toContain('21.22 JDex Manager');
    // Varias filas mencionan una carpeta sin nota (00.00, 21.01, 21.22): se busca la
    // fila EXACTA de 21.22 y se pulsa SU enlace.
    const row = [...el.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('21.22 JDex Manager')
    );
    const link = row?.querySelector('button.hebra-jdex-audit-link') as HTMLButtonElement;
    expect(link).toBeTruthy();
    link.click();
    expect(context.selectFolder).toHaveBeenCalledWith(fixture.ids.jdexManagerId.id);
  });

  it('la limpieza que devuelve activate retira todos los registros del plugin', async () => {
    const fixture = buildFixture();
    const { registry, context, workspace } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    const cleanup = await runtime.activate();
    // Con algo montado antes de apagar: la pieza de ruta y la guardia de renombrado.
    workspace.setActiveNote({ id: 'n-hebra', folderId: fixture.ids.jdexId.id, title: '21.11 Hebra' });
    expect(registry.statusBarItems().length).toBeGreaterThan(0);
    expect(workspace.guardCount).toBe(1);
    await cleanup();

    expect(workspace.guardCount).toBe(0);
    expect(registry.statusBarItems()).toHaveLength(0);
    expect(registry.commands()).toHaveLength(0);
    expect(registry.views()).toHaveLength(0);
    expect(registry.settingsPanels()).toHaveLength(0);
  });

  it('lote 5: renombrar el título de la nota JDex del ID a otro número avisa (y «Deshacer» llama a event.undo())', async () => {
    const fixture = buildFixture();
    const { context, fireNoteTitleRenamed } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();

    expect(document.querySelector('.hebra-module-notice')).toBeNull();
    const undo = vi.fn();
    fireNoteTitleRenamed({
      noteId: 'n-hebra',
      folderId: fixture.ids.jdexId.id,
      oldTitle: '21.11 Hebra',
      newTitle: '21.12 Hebra',
      undo
    });

    const notice = document.querySelector('.hebra-module-notice');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain('«21.11»');
    expect(notice?.textContent).toContain('«21.12»');
    expect(notice?.textContent).toMatch(/nunca se renumera/u);

    // El aviso es el propio botón de deshacer (`host.notice(text, onClick)`).
    const button = notice?.querySelector('button');
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it('un título sin cambio de ID ofrece renombrar la carpeta sin aviso de renumeración', async () => {
    const fixture = buildFixture();
    const { context, fireNoteTitleRenamed } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();

    fireNoteTitleRenamed({
      noteId: 'n-hebra',
      folderId: fixture.ids.jdexId.id,
      oldTitle: '21.11 Hebra',
      newTitle: '21.11 Otro título',
      undo: vi.fn()
    });

    expect(document.querySelector('.hebra-module-notice')?.textContent).toContain('Renombrar carpeta');
    expect(document.querySelector('.hebra-module-notice')?.textContent).not.toContain('pasaría');
  });

  it('un cambio de carpetas reconstruye el índice (con debounce)', async () => {
    vi.useFakeTimers();
    const fixture = buildFixture();
    const { registry, context, setFolders } = await setup(fixture);
    const runtime = jdexRuntimeExport(context);
    await runtime.activate();
    const before = registry.statusBarItems().find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    const beforeCount = Number(/^JD: (\d+)$/.exec(before.text)![1]);

    // Se crea la nota JDex que faltaba en 21.22, con el frontmatter completo (vive en
    // la carpeta JDex, no en la del ID): su hallazgo `folder-without-note` debería
    // desaparecer tras el siguiente `library-changed`, sin añadir ningún otro.
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...(fixture.notesByFolder.get(fixture.ids.jdexId.id) ?? []),
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    setFolders([...fixture.folders]);
    await vi.advanceTimersByTimeAsync(1000);

    const after = registry.statusBarItems().find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    const afterCount = Number(/^JD: (\d+)$/.exec(after.text)![1]);
    expect(afterCount).toBe(beforeCount - 1);
  });
});

// ---- PERF-07: un cambio de notas se pone al día por ids, sin recorrer la biblioteca ----

describe('un library-changed de notas (PERF-07)', () => {
  const quiet = (probe: PortProbe) => {
    probe.calls = { notesPage: 0, noteRead: 0, noteSummary: 0 };
  };

  async function activated(
    settings?: { systemRoot: string; jdexFolder: string },
    fixture = buildFixture()
  ) {
    vi.useFakeTimers();
    // Los ajustes ya guardados, por `api.storage.settings` (la clave la pone Hebra).
    const harness = await setup(fixture, settings);
    await jdexRuntimeExport(harness.context).activate();
    quiet(harness.probe);
    const auditProblems = () =>
      Number(
        /^JD: (\d+)$/.exec(
          harness.registry.statusBarItems().find((item) => item.id === JDEX_STATUS_AUDIT_ID)!.text
        )![1]
      );
    return { ...harness, fixture, auditProblems };
  }

  it('un guardado de cuerpo de una nota fuera del sistema: cero llamadas al almacén', async () => {
    // El sistema es solo `20-29…`: la nota de la carpeta `00.00 JDex` queda fuera.
    const { probe, fireNotesChange } = await activated({
      systemRoot: '20-29 Productos y servicios',
      jdexFolder: ''
    });
    fireNotesChange({ ids: ['n-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 0, noteSummary: 0 });
  });

  it('un guardado de cuerpo de una nota del sistema que no cambia su título: solo un resumen', async () => {
    const { probe, fireNotesChange } = await activated({
      systemRoot: '20-29 Productos y servicios',
      jdexFolder: ''
    });
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 0, noteSummary: 1 });
  });

  it('un título cambiado se pone al día sin recorrer carpetas ni leer cuerpos', async () => {
    const { probe, fireNotesChange, fixture } = await activated();
    fixture.notesByFolder.get(fixture.ids.hebraId.id)![0].title = 'Notas de Hebra, revisadas';
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 0, noteSummary: 1 });
  });

  it('un guardado de la nota JDex que cambia su frontmatter relee SOLO esa nota', async () => {
    const { probe, fireNotesChange, fixture, auditProblems } = await activated();
    const before = auditProblems();
    const row = fixture.notesByFolder.get(fixture.ids.jdexId.id)![0];
    // Sin descripción: el frontmatter cambia, y con él un hallazgo más.
    row.body = ['---', 'jd: 21.11', 'tipo: id', '---', ''].join('\n');
    row.revision.bodySha256 = 'sha-n-hebra-v2';
    fireNotesChange({ ids: ['n-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 1, noteSummary: 1 });
    expect(auditProblems()).toBe(before + 1);
  });

  it('los avisos de un lote se acumulan en UNA consulta', async () => {
    const { probe, fireNotesChange } = await activated();
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
    fireNotesChange({ ids: ['n-hebra'], reason: 'save' });
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.noteSummary).toBe(1);
  });

  it('anclar y ocultar no cambian nada de lo que JDex indexa: ni una llamada', async () => {
    const { probe, fireNotesChange } = await activated();
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'favorite' });
    fireNotesChange({ ids: ['n-hebra'], reason: 'hide' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 0, noteSummary: 0 });
  });

  it.each(['create', 'move', 'trash', 'restore', 'archive', 'resolve', 'purge', 'sync'] as const)(
    'una razón «%s» se resuelve por ids: una consulta de resumen y ninguna página',
    async (reason) => {
      const { probe, fireNotesChange } = await activated();
      fireNotesChange({ ids: ['n-content-hebra'], reason });
      await vi.advanceTimersByTimeAsync(2000);
      expect(probe.calls).toEqual({ notesPage: 0, noteRead: 0, noteSummary: 1 });
    }
  );

  it('el alta de la nota JDex que faltaba entra en el índice por ids y quita su hallazgo', async () => {
    const { probe, fireNotesChange, fixture, auditProblems } = await activated();
    const before = auditProblems();
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...fixture.notesByFolder.get(fixture.ids.jdexId.id)!,
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    fireNotesChange({ ids: ['n-jdex-manager'], reason: 'create' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls).toEqual({ notesPage: 0, noteRead: 1, noteSummary: 1 });
    expect(auditProblems()).toBe(before - 1);
  });

  it('una importación o una razón desconocida reconstruye todo', async () => {
    const { probe, fireNotesChange } = await activated();
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'import' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.notesPage).toBeGreaterThan(0);
    quiet(probe);
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'desconocida' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.notesPage).toBeGreaterThan(0);
  });

  it('la reconstrucción inicial fallida se cura con el siguiente guardado (no se descarta por el atajo)', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const harness = await setup(buildFixture());
    harness.probe.failNotesPage = true;
    await jdexRuntimeExport(harness.context).activate();
    const auditText = () =>
      harness.registry.statusBarItems().find((item) => item.id === JDEX_STATUS_AUDIT_ID)?.text;
    const hasAudit = () => /^JD: \d+$/.test(auditText() ?? '');
    expect(hasAudit()).toBe(false);
    harness.probe.failNotesPage = false;
    // Con `walk === null` el recorrido no sabe qué notas hay: ningún guardado es «ajeno».
    harness.fireNotesChange({ ids: ['n-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(hasAudit()).toBe(true);
    errors.mockRestore();
  });

  it('una puesta al día por ids que falla deja una reconstrucción pendiente: la nota nueva acaba en el índice', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { probe, fireNotesChange, fixture, auditProblems } = await activated();
    const before = auditProblems();
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...fixture.notesByFolder.get(fixture.ids.jdexId.id)!,
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    probe.failNoteSummary = true;
    fireNotesChange({ ids: ['n-jdex-manager'], reason: 'create' });
    await vi.advanceTimersByTimeAsync(1000);
    probe.failNoteSummary = false;
    // El aviso ya salió de `pendingIds`: solo la reconstrucción de respaldo lo recupera.
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.notesPage).toBeGreaterThan(0);
    expect(auditProblems()).toBe(before - 1);
    errors.mockRestore();
  });

  it('una reconstrucción completa que falla se reintenta sola, sin esperar a otro aviso', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { probe, setFolders, fixture } = await activated();
    probe.failNotesPage = true;
    setFolders([...fixture.folders]);
    await vi.advanceTimersByTimeAsync(1000); // el lote corre y la reconstrucción falla
    expect(probe.calls.notesPage).toBeGreaterThan(0);
    quiet(probe);
    probe.failNotesPage = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.notesPage).toBeGreaterThan(0);
    errors.mockRestore();
  });

  it('almacén caído de forma persistente: reintentos con retroceso, tope de 5 y vuelve con el siguiente aviso', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { probe, setFolders, fireNotesChange, fixture } = await activated();
    probe.failNotesPage = true;
    setFolders([...fixture.folders]);
    // Lote a los 800 ms (fallo 1), luego +800, +1.600, +3.200 y +6.400 ms: el quinto
    // fallo (a los 12.800 ms) para los reintentos; en 60 s no hay una sexta.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe.calls.notesPage).toBe(5);
    // Parado, pero con la reconstrucción pendiente: el siguiente aviso la hace.
    quiet(probe);
    probe.failNotesPage = false;
    fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe.calls.notesPage).toBeGreaterThan(0);
    errors.mockRestore();
  });

  it('PERF-13b: con un recorrido que siempre falla y guardados continuos, los intentos quedan acotados', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { probe, fireNotesChange } = await activated();
    probe.failNotesPage = true;
    probe.failNoteSummary = true;
    // Un guardado cada 5 s durante 60 s: 12 avisos. Con el contador reiniciado por cada
    // aviso salían ~3 recorridos por guardado (35 medidos: el del lote y los reintentos
    // a 800 ms y 1,6 s antes del siguiente aviso, que reiniciaba el contador). Sin reinicio, los fallos se
    // acumulan: tras el tope de 5 cada aviso da UN intento y nada más.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5000) {
      fireNotesChange({ ids: ['n-content-hebra'], reason: 'save' });
      await vi.advanceTimersByTimeAsync(5000);
    }
    // Cota: un intento por aviso (12) más los reintentos con retroceso de antes del tope
    // (5 fallos en total, así que como mucho 4 reintentos extra, 12 + 4 = 16).
    expect(probe.calls.notesPage).toBeLessThanOrEqual(16);
    expect(probe.calls.notesPage).toBeGreaterThanOrEqual(12);
    errors.mockRestore();
  });

  it('PERF-13b: apagar con una reconstrucción en vuelo que luego acaba BIEN no registra ni actualiza nada en el host', async () => {
    vi.useFakeTimers();
    const fixture = buildFixture();
    const harness = await setup(fixture);
    const cleanup = await jdexRuntimeExport(harness.context).activate();
    harness.setActiveNote({ id: 'n-hebra', folderId: fixture.ids.jdexId.id, title: '21.11 Hebra' });
    const pathItem = () =>
      harness.registry.statusBarItems().find((item) => item.id === JDEX_STATUS_PATH_ID);
    expect(pathItem()).toBeTruthy();
    // El propio objeto de la pieza: la limpieza la quita de la barra, pero si algo la
    // repintara tras apagar, su texto cambiaría.
    const auditItem = harness.registry
      .statusBarItems()
      .find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    const auditText = () => auditItem.text;
    const auditBefore = auditText();
    // La biblioteca cambia (falta la nota de 21.22: un hallazgo menos) mientras se lee.
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...fixture.notesByFolder.get(fixture.ids.jdexId.id)!,
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    let release: () => void = () => {};
    harness.probe.holdNotesPage = new Promise<void>((resolve) => (release = resolve));
    harness.setFolders([...harness.context.folders()]);
    await vi.advanceTimersByTimeAsync(1000); // el lote corre y el recorrido queda en vuelo
    await cleanup();
    expect(pathItem()).toBeUndefined();
    expect(harness.registry.statusBarItems()).not.toContain(auditItem);
    release(); // el recorrido acaba bien, ya apagado
    await vi.advanceTimersByTimeAsync(5000);
    expect(pathItem()).toBeUndefined();
    // Ni el contador de auditoría se repinta con lo leído tras el apagado.
    expect(auditText()).toBe(auditBefore);
  });

  it('apagar el módulo con una reconstrucción en vuelo que falla después: no se rearma nada', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    const harness = await setup(buildFixture());
    const cleanup = await jdexRuntimeExport(harness.context).activate();
    quiet(harness.probe);
    let fail: () => void = () => {};
    harness.probe.gateNotesPage = new Promise<void>((resolve) => (fail = resolve));
    harness.setFolders([...harness.context.folders()]);
    await vi.advanceTimersByTimeAsync(1000); // el lote corre y la lectura queda en vuelo
    expect(harness.probe.calls.notesPage).toBe(1);
    await cleanup();
    fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.probe.calls.notesPage).toBe(1);
    errors.mockRestore();
  });

  it('un aviso de notas que llega durante la reconstrucción inicial acaba en el índice', async () => {
    vi.useFakeTimers();
    const baseline = await activated();
    const before = baseline.auditProblems();
    const fixture = buildFixture();
    const harness = await setup(fixture);
    let release: () => void = () => {};
    harness.probe.holdNoteRead = () => new Promise<void>((resolve) => (release = resolve));
    const activating = jdexRuntimeExport(harness.context).activate();
    await vi.advanceTimersByTimeAsync(10); // la reconstrucción inicial queda en la lectura
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...fixture.notesByFolder.get(fixture.ids.jdexId.id)!,
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    harness.fireNotesChange({ ids: ['n-jdex-manager'], reason: 'create' });
    release();
    await activating;
    await vi.advanceTimersByTimeAsync(3000);
    const text = harness.registry.statusBarItems().find((i) => i.id === JDEX_STATUS_AUDIT_ID)!.text;
    expect(Number(/^JD: (\d+)$/.exec(text)![1])).toBe(before - 1);
  });

  it('una reconstrucción lenta que termina después de otra más nueva no pisa el índice', async () => {
    const { probe, setFolders, fixture, auditProblems } = await activated();
    const stale = auditProblems();
    // R1 recorre las carpetas con el estado de ahora y se queda esperando en su primera
    // lectura de la nota JDex.
    let release: () => void = () => {};
    probe.holdNoteRead = () => new Promise<void>((resolve) => (release = resolve));
    setFolders([...fixture.folders]);
    await vi.advanceTimersByTimeAsync(1000);
    // Cambia la biblioteca (falta la nota de 21.22: un hallazgo menos) y arranca R2, que
    // acaba antes que R1.
    fixture.notesByFolder.set(fixture.ids.jdexId.id, [
      ...fixture.notesByFolder.get(fixture.ids.jdexId.id)!,
      noteRow(
        'n-jdex-manager',
        fixture.ids.jdexId.id,
        '21.22 JDex Manager',
        [
          '---',
          'jd: 21.22',
          'tipo: id',
          'area: 20-29 Productos y servicios',
          'categoria: 21 Productos de software propios',
          'descripcion: El propio JDex Manager.',
          '---',
          ''
        ].join('\n')
      )
    ]);
    setFolders([...fixture.folders]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(auditProblems()).toBe(stale - 1);
    // R1, por fin, termina con lo que leyó ANTES del cambio: se descarta.
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(auditProblems()).toBe(stale - 1);
  });
});
