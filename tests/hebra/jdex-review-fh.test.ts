// @vitest-environment happy-dom
/**
 * Code review of the Hebra side (diff 397d6ad..3636e31), batch FH: regressions found in the
 * journal wrapper, the creation dialogs, the settings echo and the folder rename guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, JOURNAL_VERSION, type Operation } from '../../src/hebra/engine';
import { JDEX_COMMAND_CREATE_CATEGORY, JDEX_COMMAND_HEALTH, JDEX_COMMAND_SEND_TO_INBOX, JDEX_COMMAND_UNDO } from '../../src/hebra/jdex-runtime';
import { guardJdexJournal } from '../../src/hebra/jdex-lifecycle';
import { createJdexFolderRenameGuard } from '../../src/hebra/jdex-folder-rename';
import { writeJdexBuiltinTemplates } from '../../src/hebra/jdex-templates';
import { jdexLocateActiveNote } from '../../src/hebra/jdex-active-note-commands';
import { buildIndex } from '../../src/hebra/engine';
import { JDEX_REWRITE_BATCH_MAX, JdexPartialRewriteError, rewriteJdexNotes } from '../../src/hebra/jdex-write';
import { createJdexJournal, JdexJournalSaveError, type JdexJournal, type JdexJournalEffect } from '../../src/hebra/jdex-journal';
import { activateJdex } from './support/activate';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';
const REPORTS = '00-09 Sistema/00 Sistema/00.02 Informes';
const EMPTY_HEADER = '# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n';
const EMPTY_INDEX = '# 00.00 JDex del sistema\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n';

function libraryVault(): FakeJdexVault {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('reports', 'sys-cat', '00.02 Informes'),
    fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', '21.11 Antes'),
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '# 21.11 Antes #claude\n\nDescripción.\n'));
  vault.seedNote(fakeNote('n-header', 'jdex', EMPTY_HEADER));
  vault.seedNote(fakeNote('n-index', 'jdex', EMPTY_INDEX));
  return vault;
}

async function setup(overrides: Record<string, unknown> = {}) {
  const vault = libraryVault();
  const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS, subfolderPattern: '70 Adjuntos', ...overrides } });
  const cleanup = await activateJdex(api);
  return { vault, api, fake, workspace, cleanup };
}

function command(fake: { recorded: { commands: { id: string; run: () => unknown }[] } }, id: string) {
  return fake.recorded.commands.find((entry) => entry.id === id)!;
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('FH 1-2: the disposal guard forwards every argument of the journal', () => {
  it('passes the run options and the expected id through, and every other method unchanged', async () => {
    const calls: Record<string, unknown[]> = {};
    const record = (name: string) => (...args: unknown[]) => { calls[name] = args; return Promise.resolve(name === 'undoLast' ? { undone: 0, warnings: [] } : true); };
    const inner = {
      device: 'A',
      entries: () => [],
      status: () => ({ unsaved: false, readOnly: false }),
      run: (...args: unknown[]) => { calls.run = args; return (args[2] as (vault: unknown) => Promise<unknown>)('vault'); },
      undoLast: record('undoLast'),
      discardLast: record('discardLast'),
      absorb: (...args: unknown[]) => { calls.absorb = args; },
      observe: (...args: unknown[]) => { calls.observe = args; }
    } as unknown as JdexJournal;
    const guarded = guardJdexJournal(inner, () => false);
    await guarded.run('fix', 'Etiqueta', async () => 'hecho', { automatic: true });
    expect(calls.run?.[0]).toBe('fix');
    expect(calls.run?.[1]).toBe('Etiqueta');
    expect(calls.run?.[3]).toEqual({ automatic: true });
    await guarded.undoLast('op-1');
    expect(calls.undoLast).toEqual(['op-1']);
    await guarded.discardLast('op-2');
    expect(calls.discardLast).toEqual(['op-2']);
    guarded.absorb({ x: 1 });
    expect(calls.absorb).toEqual([{ x: 1 }]);
    guarded.observe(['n1']);
    expect(calls.observe).toEqual([['n1']]);
    expect(guarded.device).toBe('A');
  });
});

describe('FH 1: automatic writes after an undo stay automatic (runtime)', () => {
  it('undoing the live header update is not redone by the next header sync, and adds no entry', async () => {
    const { vault, api, fake, workspace, cleanup } = await setup({ liveHeaders: true });
    vi.useFakeTimers();
    workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-header'))?.body).toContain('21.11');
    await command(fake, JDEX_COMMAND_UNDO).run();
    expect(document.querySelector('dialog')?.textContent).toContain('Actualizar cabeceras');
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(async () => expect((await vault.noteRead('n-header'))?.body).toBe(EMPTY_HEADER));
    expect((await vault.noteRead('n-index'))?.body).toBe(EMPTY_INDEX);
    const writes = vault.rewriteCalls.length;
    // The host's own notice of the undo writes, then the next derived sync.
    workspace.emitNotes({ ids: ['n-header', 'n-index'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-header'))?.body).toBe(EMPTY_HEADER);
    expect((await vault.noteRead('n-index'))?.body).toBe(EMPTY_INDEX);
    expect(vault.rewriteCalls).toHaveLength(writes);
    const stored = await api.storage.settings.load<{ jdexJournal: unknown[] }>();
    expect(stored?.jdexJournal).toEqual([]);
    await cleanup();
  });
});

describe('FH 2: undo acts on the operation the dialog showed (runtime)', () => {
  it('an operation that lands between opening the dialog and confirming is not undone', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    await command(fake, JDEX_COMMAND_HEALTH).run();
    await command(fake, JDEX_COMMAND_UNDO).run();
    expect(document.querySelector('dialog')?.textContent).toContain('Crear informe de salud');
    // A second report while the dialog is open: it becomes the last operation.
    await command(fake, JDEX_COMMAND_HEALTH).run();
    const [first, second] = (workspace.openNote as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(() => expect(fake.recorded.notices.join(' ')).toContain('cambió desde que se abrió'));
    expect((await vault.noteRead(first))?.trashedAt).toBeNull();
    expect((await vault.noteRead(second))?.trashedAt).toBeNull();
    await cleanup();
  });
});

describe('FH 4: the host echoes our own settings saves (runtime)', () => {
  it('saving the journal (discard) does not reload the settings nor walk the library again', async () => {
    const { vault, fake, cleanup } = await setup();
    await command(fake, JDEX_COMMAND_HEALTH).run();
    vi.useFakeTimers();
    const walks = vi.spyOn(vault, 'foldersList');
    await command(fake, JDEX_COMMAND_UNDO).run();
    const discard = document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-discard')!;
    discard.click();
    discard.click(); // the second click confirms
    await vi.waitFor(() => expect(fake.recorded.notices.join(' | ')).toContain('se quitó del diario'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(walks).not.toHaveBeenCalled();
    await cleanup();
  });

  it('a change from elsewhere that does not touch the index is adopted without a walk', async () => {
    const { vault, api, cleanup, settingsFromElsewhere } = await setupWithHarness();
    vi.useFakeTimers();
    const walks = vi.spyOn(vault, 'foldersList');
    const stored = await api.storage.settings.load<Record<string, unknown>>();
    settingsFromElsewhere({ ...stored, autocomplete: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(walks).not.toHaveBeenCalled();
    await cleanup();
  });

  it('control: a change from elsewhere to the JDex folder rebuilds', async () => {
    const { vault, api, cleanup, settingsFromElsewhere } = await setupWithHarness();
    vi.useFakeTimers();
    const walks = vi.spyOn(vault, 'foldersList');
    const stored = await api.storage.settings.load<Record<string, unknown>>();
    settingsFromElsewhere({ ...stored, jdexFolder: REPORTS });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(walks).toHaveBeenCalled();
    await cleanup();
  });
});

describe('FH 5: without an index the rename guard does not let a renumbering through', () => {
  it('refuses the change with a notice while there is no index, and writes nothing', async () => {
    const notices: string[] = [];
    const write = vi.fn();
    const guard = createJdexFolderRenameGuard({
      ui: { notice: (text: string) => void notices.push(text), openModal: vi.fn() },
      markdown: { withTitle: (body: string) => body },
      snapshot: () => null,
      write,
      report: vi.fn()
    });
    expect(await guard.confirm({ kind: 'folder-rename', folderId: 'f-id', newName: '21.12 Otro número' } as never)).toBe(false);
    expect(notices.join(' ')).toContain('aún está cargando el índice');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('FH 6: recovery at load touches only this device\'s operations', () => {
  function journalVault(): FakeJdexVault {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, '21 Cat'));
    vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
    vault.seedNote(fakeNote('n2', 'f1', '# Dos\n'));
    vault.seedNote(fakeNote('n3', 'f1', '# Tres editado\n'));
    return vault;
  }
  // n1: an intent that never ran; n2: an inverse already applied (the body is `before`).
  const interrupted = (): JdexJournalEffect[] => [
    { kind: 'note-rewrite', id: 'n1', before: '# Uno\n', after: '# Uno editado\n', pending: true },
    { kind: 'note-rewrite', id: 'n2', before: '# Dos\n', after: '# Dos editado\n', undoing: true, revision: { localSeq: 2, bodySha256: 'x' } }
  ];
  async function storageWith(entries: Operation<JdexJournalEffect>[]) {
    const harness = await createJdexTestApi();
    await harness.api.storage.settings.save({ jdexJournal: entries, jdexJournalVersion: JOURNAL_VERSION });
    return harness.api.storage.settings;
  }

  it('leaves the interrupted steps of another device as they are, and does not save', async () => {
    const storage = await storageWith([{ id: 'op-b', device: 'B', kind: 'fix', label: 'De B', at: '2026-10-12T10:00:00.000Z', effects: interrupted(), rev: 3 }]);
    const save = vi.spyOn(storage, 'save');
    const journal = await createJdexJournal(journalVault(), storage, { device: 'A' });
    expect(journal.entries()).toHaveLength(1);
    expect(journal.entries()[0].effects).toEqual(interrupted());
    expect(journal.entries()[0].rev).toBe(3);
    expect(save).not.toHaveBeenCalled();
  });

  it('recovers its own steps, raises rev, and an operation left empty stays removed after a reload', async () => {
    const written: JdexJournalEffect = { kind: 'note-rewrite', id: 'n3', before: '# Tres\n', after: '# Tres editado\n', revision: { localSeq: 2, bodySha256: 'y' } };
    const storage = await storageWith([
      { id: 'op-empty', device: 'A', kind: 'fix', label: 'Vacía', at: '2026-10-12T10:00:00.000Z', effects: interrupted(), rev: 3 },
      { id: 'op-own', device: 'A', kind: 'fix', label: 'Propia', at: '2026-10-12T10:01:00.000Z', effects: [interrupted()[0], written], rev: 3 },
      { id: 'op-old', kind: 'fix', label: 'Sin dispositivo', at: '2026-10-12T10:02:00.000Z', effects: [interrupted()[0]], rev: 1 }
    ]);
    const journal = await createJdexJournal(journalVault(), storage, { device: 'A' });
    expect(journal.entries().map((op) => op.id)).toEqual(['op-own']);
    expect(journal.entries()[0].effects).toEqual([written]);
    expect(journal.entries()[0].rev).toBeGreaterThan(3);
    const reloaded = await createJdexJournal(journalVault(), storage, { device: 'A' });
    expect(reloaded.entries().map((op) => op.id)).toEqual(['op-own']);
  });
});

describe('FH 7: the journal fits in the settings Hebra syncs', () => {
  /** Hebra does not publish a settings blob longer than this (`MAX_SYNCED_SETTINGS_CHARS`,
   *  `src/lib/plugins/sync/plugins-doc.ts`), and reconciliation then overwrites it. */
  const HOST_MAX_SYNCED_SETTINGS_CHARS = 256 * 1024;

  it('a 300-note rewrite of ~2 KB notes stays under the host limit, and the user is told what cannot be undone', async () => {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, '00.00 JDex'));
    const filler = 'Texto de una nota JDex real con su descripción y enlaces. '.repeat(34);
    const ids = Array.from({ length: 300 }, (_, i) => `n${i}`);
    for (const id of ids) vault.seedNote(fakeNote(id, 'f1', `# 21.${id} Nota\n\n${filler}\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n`));
    const { api } = await createJdexTestApi();
    const trimmed: string[] = [];
    const journal = await createJdexJournal(vault, api.storage.settings, { device: 'A', onTrimmed: (message) => trimmed.push(message) });
    await journal.run('fix', 'Actualizar cabeceras', (tracked) => rewriteJdexNotes(tracked, ids, ({ body }) => body.replace('<!-- /jdex:hijos -->', '- 21.11\n<!-- /jdex:hijos -->')));
    const size = JSON.stringify(await api.storage.settings.load()).length;
    console.info(`[FH 7] serialized settings after a 300-note rewrite: ${size} chars (host limit ${HOST_MAX_SYNCED_SETTINGS_CHARS})`);
    expect(size).toBeLessThanOrEqual(HOST_MAX_SYNCED_SETTINGS_CHARS);
    expect(trimmed.join(' ')).toContain('Actualizar cabeceras');
  });

  it('drops the oldest operations first and keeps the later ones undoable', async () => {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, '00.00 JDex'));
    const filler = 'x'.repeat(2_000);
    const group = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}${i}`);
    for (const id of [...group('a', 40), ...group('b', 40), 'c0']) vault.seedNote(fakeNote(id, 'f1', `# ${id}\n\n${filler}\n`));
    const { api } = await createJdexTestApi();
    const trimmed: string[] = [];
    const journal = await createJdexJournal(vault, api.storage.settings, { device: 'A', onTrimmed: (message) => trimmed.push(message) });
    const touch = (ids: string[]) => (tracked: Parameters<typeof rewriteJdexNotes>[0]) => rewriteJdexNotes(tracked, ids, ({ body }) => `${body}editado\n`);
    await journal.run('fix', 'A', touch(group('a', 40)));
    await journal.run('fix', 'B', touch(group('b', 40)));
    await journal.run('fix', 'C', touch(['c0']));
    expect(journal.entries().map((operation) => operation.label)).toEqual(['B', 'C']);
    expect(trimmed).toEqual(['«A» ya no se puede deshacer: el diario de deshacer superaba el tamaño que Hebra sincroniza entre dispositivos.']);
    expect(JSON.stringify(await api.storage.settings.load()).length).toBeLessThanOrEqual(HOST_MAX_SYNCED_SETTINGS_CHARS);
    expect((await journal.undoLast(journal.entries()[1].id)).undone).toBe(1);
  });
});

describe('FH 8: a partial rewrite says whether what was written can be undone', () => {
  async function failSecondBatch(cause: Error): Promise<Error> {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, '00.00 JDex'));
    const ids = Array.from({ length: JDEX_REWRITE_BATCH_MAX + 1 }, (_, i) => `n${i}`);
    for (const id of ids) vault.seedNote(fakeNote(id, 'f1', `# ${id}\n`));
    let calls = 0;
    const library = {
      noteRead: (id: string) => vault.noteRead(id),
      notesRewriteBatch: (...args: Parameters<FakeJdexVault['notesRewriteBatch']>) => {
        calls += 1;
        if (calls === 2) return Promise.reject(cause);
        return vault.notesRewriteBatch(...args);
      }
    };
    return rewriteJdexNotes(library, ids, ({ body }) => `${body}editado\n`).then(() => { throw new Error('no falló'); }, (error: Error) => error);
  }

  it('when the journal could not be saved, it does not promise an undo', async () => {
    const error = await failSecondBatch(new JdexJournalSaveError(new Error('disco lleno')));
    expect(error).toBeInstanceOf(JdexPartialRewriteError);
    expect(error.message).not.toContain('se puede deshacer');
    expect(error.message).toContain('no se pudo guardar');
  });

  it('control: any other cause keeps the undo hint', async () => {
    const error = await failSecondBatch(new Error('host caído'));
    expect(error.message).toContain('se puede deshacer');
  });
});

describe('FH 9: a path edited by hand in the panel stops following the old folder after a restart', () => {
  it('keeps the typed reports path after deactivating and activating again', async () => {
    const { api, fake, cleanup } = await setupWithHarness();
    expect((await api.storage.settings.load<{ jdexFolderIds: Record<string, string> }>())?.jdexFolderIds.reportsFolder).toBe('reports');
    const el = document.createElement('div');
    document.body.append(el);
    fake.recorded.settingsPanels[0](el);
    const input = [...el.querySelectorAll('input')].find((entry) => entry.value === REPORTS)!;
    input.value = 'Informes nuevos';
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect((await api.storage.settings.load<{ reportsFolder: string }>())?.reportsFolder).toBe('Informes nuevos'));
    await cleanup();
    const again = await activateJdex(api);
    expect((await api.storage.settings.load<{ reportsFolder: string }>())?.reportsFolder).toBe('Informes nuevos');
    await again();
  });
});

describe('FH 10: built-in templates are not written twice into a folder outside the walk', () => {
  it('a second run finds the four templates by name in the real folder', async () => {
    const library = new FakeJdexVault();
    library.seedFolder(fakeFolder('f-templates', null, 'Plantillas'));
    // The templates folder is outside the system walk: the walk lists none of its notes.
    const walk = { rootFolderId: 'root', folderPaths: new Map([['f-templates', 'Plantillas']]), systemFolderPaths: [], systemNotes: [] };
    const settings = { ...DEFAULT_SETTINGS, templatesFolder: 'Plantillas' };
    const markdown = { withTitle: (body: string, title: string) => `# ${title}\n\n${body}` };
    expect((await writeJdexBuiltinTemplates(library, markdown, walk, settings)).created).toHaveLength(4);
    const again = await writeJdexBuiltinTemplates(library, markdown, walk, settings);
    expect(again.created).toEqual([]);
    expect(again.existing).toHaveLength(4);
    const page = await library.notesPage(null, 100, { kind: 'folder', folderId: 'f-templates' });
    expect(page.items).toHaveLength(4);
  });
});

describe('FH 11: active-note commands resolve the note like the path item', () => {
  it('takes the walk path of the note by id (a same-title note keeps its own tie-break path)', () => {
    const folderPaths = new Map([['jdex', JDEX]]);
    const first = { id: 'n-a', folderId: 'jdex', title: '21.11 Hebra', path: `${JDEX}/21.11 Hebra.md` };
    const second = { id: 'n-b', folderId: 'jdex', title: '21.11 Hebra', path: `${JDEX}/21.11 Hebra--0000000b.md`, basePath: first.path };
    const walk = { rootFolderId: 'root', folderPaths, systemFolderPaths: [JDEX], systemNotes: [first, second] };
    const index = buildIndex({ systemRoot: '', jdexFolder: JDEX, folderPaths: [JDEX], notePaths: [first.path, second.path] });
    const found = jdexLocateActiveNote({ id: 'n-b', folderId: 'jdex', title: '21.11 Hebra' }, walk, index, JDEX);
    expect(found?.ref.path).toBe(second.path);
  });

  it('refuses to send the note of a repeated number to its inbox', async () => {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'), fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
      fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
      fakeFolder('inbox', 'cat', '21.01 Bandeja de entrada'), fakeFolder('id', 'cat', '21.11 Hebra')
    ]) vault.seedFolder(folder);
    vault.seedNote(fakeNote('n-hebra', 'jdex', '# 21.11 Hebra\n'));
    vault.seedNote(fakeNote('n-otra', 'jdex', '# 21.11 Otra\n'));
    vault.seedNote(fakeNote('n-content', 'id', '# Idea\n'));
    const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
    const cleanup = await activateJdex(api);
    workspace.setActiveNote({ id: 'n-content', folderId: 'id', title: 'Idea' });
    await command(fake, JDEX_COMMAND_SEND_TO_INBOX).run();
    expect(fake.recorded.notices.join(' ')).toContain('está repetido');
    expect((await vault.noteRead('n-content'))?.folderId).toBe('id');
    await cleanup();
  });
});

describe('FH 12: an automatic rewrite counts the notes an undo protects as skipped', () => {
  it('reports the protected note in skipped, not lost between written and stale', async () => {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, '00.00 JDex'));
    vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
    vault.seedNote(fakeNote('n2', 'f1', '# Dos\n'));
    const { api } = await createJdexTestApi();
    const journal = await createJdexJournal(vault, api.storage.settings, { device: 'A', now: () => 0 });
    await journal.run('fix', 'Normalizar', (tracked) => rewriteJdexNotes(tracked, ['n1'], ({ body }) => `${body}editado\n`));
    await journal.undoLast(journal.entries()[0].id);
    const result = await journal.run('fix', 'Cabeceras vivas', (tracked) => rewriteJdexNotes(tracked, ['n1', 'n2'], ({ body }) => `${body}vivo\n`), { automatic: true });
    expect(result.written).toEqual(['n2']);
    expect(result.skipped).toEqual(['n1']);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
  });
});

async function setupWithHarness() {
  const vault = libraryVault();
  const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS } });
  const cleanup = await activateJdex(harness.api);
  return { ...harness, vault, cleanup };
}

describe('FH 3: creating a category in another system checks that system only (runtime)', () => {
  async function prefixed(settings: Record<string, unknown>, notes: [string, string][]) {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'), fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
      fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
      fakeFolder('d02', null, 'D02.20-29 Casa')
    ]) vault.seedFolder(folder);
    for (const [id, body] of notes) vault.seedNote(fakeNote(id, 'jdex', body));
    const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, ...settings } });
    const cleanup = await activateJdex(harness.api);
    void command(harness.fake, JDEX_COMMAND_CREATE_CATEGORY).run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal') as HTMLDialogElement;
    const select = dialog.querySelector('select') as HTMLSelectElement;
    select.value = 'D02.20-29';
    select.dispatchEvent(new Event('change'));
    const [number, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    title.value = 'Hogar';
    title.dispatchEvent(new Event('input'));
    return { ...harness, vault, cleanup, dialog, number };
  }
  async function jdexTitles(vault: FakeJdexVault): Promise<string[]> {
    const page = await vault.notesPage(null, 100, { kind: 'folder', folderId: 'jdex' });
    return page.items.map((item) => item.title);
  }

  it('without a prefix, a D02.21 made elsewhere while the dialog was open is not created twice', async () => {
    const { vault, workspace, cleanup, dialog, number } = await prefixed({}, [['n-id', '# 21.11 Algo\n']]);
    expect(number.value).toBe('21');
    vault.seedNote(fakeNote('n-other', 'jdex', '# D02.21 Hogar de otro dispositivo\n'));
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(dialog.querySelector('.hebra-jdex-dialog-error')?.textContent).toContain('Siguiente libre: 22'));
    expect(workspace.openNote).not.toHaveBeenCalled();
    expect((await jdexTitles(vault)).filter((title) => title.startsWith('D02.21'))).toHaveLength(1);
    await cleanup();
  });

  it('with D01 configured, D01.21 does not block creating D02.21', async () => {
    const { vault, fake, workspace, cleanup, dialog, number } = await prefixed({ systemId: 'D01', prefixNamesWithSystem: true }, [['n-d01', '# D01.21 Productos\n']]);
    expect(number.value).toBe('21');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote, `${dialog.querySelector('.hebra-jdex-dialog-error')?.textContent} | ${fake.recorded.notices.join(' | ')}`).toHaveBeenCalled());
    expect(fake.recorded.notices.join(' ')).not.toContain('ya existe');
    expect(await jdexTitles(vault)).toContain('D02.21 Hogar');
    await cleanup();
  });
});
