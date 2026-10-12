// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026, finding 15 (Hebra): the JDex folder is followed by id when it is
 * renamed (or an ancestor is), its notes are indexed even outside the system root, and a
 * missing configured folder is reported instead of silently emptying the index.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { followTrackedFolders } from '../../src/hebra/jdex-folder-tracking';
import { JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_CREATE_ID, JDEX_STATUS_AUDIT_ID } from '../../src/hebra/jdex-runtime';
import { activateJdex } from './support/activate';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';

function seed(vault: FakeJdexVault): void {
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', '21.11 Algo')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '---\ndescripcion: "Algo."\n---\n# 21.11 Algo\n'));
}

async function setup(settings: Record<string, unknown> = {}) {
  const vault = new FakeJdexVault();
  seed(vault);
  const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, ...settings } });
  const cleanup = await activateJdex(harness.api);
  const auditText = () => {
    const el = document.createElement('div');
    harness.fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    return el.textContent ?? '';
  };
  const stored = async () => (await harness.api.storage.settings.load<{ jdexFolder: string }>())!;
  return { ...harness, vault, cleanup, auditText, stored };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('Hebra: the JDex folder is followed by id (061b492e)', () => {
  it('renaming the JDex folder keeps the index complete and updates the setting', async () => {
    const { vault, workspace, fake, cleanup, auditText, stored } = await setup();
    expect(auditText()).not.toContain('La carpeta 21.11 Algo no tiene nota');
    vi.useFakeTimers();
    await vault.folderRename('jdex', '00.00 JDex del sistema');
    workspace.emitFolders(await vault.foldersList());
    await vi.advanceTimersByTimeAsync(800);
    expect((await stored()).jdexFolder).toBe('00-09 Sistema/00 Sistema/00.00 JDex del sistema');
    expect(auditText()).not.toContain('La carpeta 21.11 Algo no tiene nota');
    expect(auditText()).not.toContain('no existe');
    expect(fake.recorded.notices.some((notice) => notice.includes('La carpeta JDex cambió de sitio'))).toBe(true);
    await cleanup();
  });

  it('renaming an ancestor of the JDex folder is followed too', async () => {
    const { vault, workspace, cleanup, auditText, stored } = await setup();
    vi.useFakeTimers();
    await vault.folderRename('sys-cat', '00 Gestión');
    workspace.emitFolders(await vault.foldersList());
    await vi.advanceTimersByTimeAsync(800);
    expect((await stored()).jdexFolder).toBe('00-09 Sistema/00 Gestión/00.00 JDex');
    expect(auditText()).not.toContain('La carpeta 21.11 Algo no tiene nota');
    await cleanup();
  });

  it('a deleted JDex folder is reported and never recreated at the old path', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: `${JDEX} borrada` } });
    const cleanup = await activateJdex(harness.api);
    const el = document.createElement('div');
    harness.fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    expect(el.textContent).toContain(`La carpeta JDex configurada («${JDEX} borrada») no existe`);
    expect(harness.fake.recorded.statusBarItems.find((item) => item.id === JDEX_STATUS_AUDIT_ID)?.text).not.toBe('JD: 0');
    void harness.fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_CREATE_ID)!.run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal');
    if (dialog) {
      const [, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
      title.value = 'Nueva';
      title.dispatchEvent(new Event('input'));
      (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(document.body.textContent).toContain('ya no existe'));
    }
    expect((await vault.foldersList()).some((folder) => folder.name === '00.00 JDex borrada')).toBe(false);
    await cleanup();
  });

  it('a JDex folder outside the system root is still indexed, also by id updates', async () => {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'),
      fakeFolder('sys-cat', 'sys', '00 Sistema'),
      fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
      fakeFolder('work', null, 'Trabajo'),
      fakeFolder('area', 'work', '20-29 Productos'),
      fakeFolder('cat', 'area', '21 Software'),
      fakeFolder('id', 'cat', '21.11 Algo')
    ]) vault.seedFolder(folder);
    vault.seedNote(fakeNote('n-id', 'jdex', '---\ndescripcion: "Algo."\n---\n# 21.11 Algo\n'));
    const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, systemRoot: 'Trabajo' } });
    const cleanup = await activateJdex(harness.api);
    const auditText = () => {
      const el = document.createElement('div');
      harness.fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
      return el.textContent ?? '';
    };
    expect(auditText()).not.toContain('La carpeta 21.11 Algo no tiene nota');
    vi.useFakeTimers();
    vault.saveElsewhere('n-id', '---\ndescripcion: "Otra."\n---\n# 21.11 Algo\n');
    harness.workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(auditText()).not.toContain('La carpeta 21.11 Algo no tiene nota');
    await cleanup();
  });
});

describe('followTrackedFolders', () => {
  const paths = new Map([['a', 'A'], ['b', 'B']]);

  it('records the id of a configured path that resolves', () => {
    const result = followTrackedFolders({ ...DEFAULT_SETTINGS, jdexFolder: 'A' }, {}, paths);
    expect(result).toMatchObject({ ids: { jdexFolder: 'a' }, moved: [], changed: true });
  });

  it('follows a recorded folder whose path changed', () => {
    const result = followTrackedFolders({ ...DEFAULT_SETTINGS, jdexFolder: 'Old' }, { jdexFolder: 'b' }, paths);
    expect(result.settings.jdexFolder).toBe('B');
    expect(result.moved).toEqual([{ key: 'jdexFolder', from: 'Old', to: 'B' }]);
  });

  it('a configured path that resolves wins over the recorded id (manual change)', () => {
    const result = followTrackedFolders({ ...DEFAULT_SETTINGS, jdexFolder: 'A' }, { jdexFolder: 'b' }, paths);
    expect(result.settings.jdexFolder).toBe('A');
    expect(result.ids.jdexFolder).toBe('a');
    expect(result.moved).toEqual([]);
  });

  it('leaves a dead path alone when its folder is gone', () => {
    const result = followTrackedFolders({ ...DEFAULT_SETTINGS, jdexFolder: 'Old' }, { jdexFolder: 'gone' }, paths);
    expect(result.settings.jdexFolder).toBe('Old');
    expect(result.changed).toBe(false);
  });
});
