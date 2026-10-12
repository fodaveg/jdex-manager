// @vitest-environment happy-dom
/**
 * Code review of the Hebra side (diff 397d6ad..3636e31), batch FH: regressions found in the
 * journal wrapper, the creation dialogs, the settings echo and the folder rename guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { JDEX_COMMAND_CREATE_CATEGORY, JDEX_COMMAND_HEALTH, JDEX_COMMAND_UNDO } from '../../src/hebra/jdex-runtime';
import { guardJdexJournal } from '../../src/hebra/jdex-lifecycle';
import type { JdexJournal } from '../../src/hebra/jdex-journal';
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
