// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { activateJdex, JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_SYSTEM_REPORT } from '../../src/hebra/jdex-runtime';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';
const REPORTS = '00-09 Sistema/00 Sistema/00.02 Informes';

async function setup(automaticMaintenance = false) {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('reports', 'sys-cat', '00.02 Informes'),
    fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', '21.11 Antes'),
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '# 21.11 Antes #claude\n\nDescripción.\n'));
  vault.seedNote(fakeNote('n-header', 'jdex', '# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n'));
  vault.seedNote(fakeNote('n-index', 'jdex', '# 00.00 JDex del sistema\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n'));
  const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS, subfolderPattern: '70 Adjuntos', automaticMaintenance, liveHeaders: false } });
  const cleanup = await activateJdex(api);
  return { vault, api, fake, workspace, cleanup };
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('L8 runtime Hebra', () => {
  it('only writes derived fields and managed lists with maintenance enabled, without an event loop', async () => {
    const { vault, api, workspace, cleanup } = await setup(true);
    vi.useFakeTimers();
    workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-id'))?.body).toContain('jd:');
    expect((await vault.noteRead('n-id'))?.body).not.toContain('descripcion:');
    expect((await vault.noteRead('n-header'))?.body).toContain('21.11 Antes');
    expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Antes');
    const writes = vault.rewriteCalls.length;
    workspace.emitNotes({ ids: ['n-id', 'n-header', 'n-index'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(vault.rewriteCalls).toHaveLength(writes);
    const stored = await api.storage.settings.load<{ jdexJournal: unknown[] }>();
    expect(stored?.jdexJournal.length).toBeGreaterThan(0);
    await cleanup();
  });

  it('leaves derived fields alone by default and generates manual comparable reports', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    vi.useFakeTimers();
    workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(vault.rewriteCalls).toHaveLength(0);
    const command = fake.recorded.commands.find((entry) => entry.id === JDEX_COMMAND_SYSTEM_REPORT)!;
    await command.run();
    await command.run();
    expect(workspace.openNote).toHaveBeenCalledTimes(2);
    const ids = (workspace.openNote as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(ids[0]).not.toBe(ids[1]);
    expect((await vault.noteRead(ids[0]))?.body).toContain('Primer informe comparable');
    expect((await vault.noteRead(ids[1]))?.body).toContain('Sin cambios en los indicadores');
    await cleanup();
  });

  it('reports old inbox notes using their creation date', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    vi.useFakeTimers();
    vault.seedFolder(fakeFolder('inbox', 'cat', '21.01 Inbox'));
    vault.seedNote(fakeNote('old', 'inbox', '# Old inbox note\n'));
    workspace.emitFolders(await vault.foldersList());
    await vi.advanceTimersByTimeAsync(800);
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    expect(el.textContent).toContain('más de 30 días');
    await cleanup();
  });
});
