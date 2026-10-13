// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026 (index coherence), findings 11 and 13, Hebra: open editors and the
 * open audit view follow the index (e615938a); turning the module off closes its dialogs
 * and stops an in-flight «Reparar» (0ebb2751).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_CREATE_ID } from '../../src/hebra/jdex-runtime';
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
    fakeFolder('id', 'cat', '21.11 Algo'),
    fakeFolder('id2', 'cat', '21.12 Otro')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '---\ndescripcion: "Algo."\n---\n# 21.11 Algo\n'));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('Hebra: views follow the index (e615938a)', () => {
  it('the open audit view shows the findings after an external change, not the mounted ones', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
    const cleanup = await activateJdex(api);
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    expect(el.textContent).toContain('La carpeta 21.12 Otro no tiene nota');
    vi.useFakeTimers();
    vault.seedNote(fakeNote('n-new', 'jdex', '---\ndescripcion: "Otro."\n---\n# 21.12 Otro\n'));
    workspace.emitNotes({ ids: ['n-new'], reason: 'sync' });
    await vi.advanceTimersByTimeAsync(800);
    expect(el.textContent).not.toContain('La carpeta 21.12 Otro no tiene nota');
    await cleanup();
  });
});

describe('Hebra: turning the module off stops its writes (0ebb2751)', () => {
  it('closes an open dialog and an in-flight «Reparar» writes nothing afterwards', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    // Two frontmatter findings «Reparar» would fix (selected by default).
    vault.seedNote(fakeNote('n-a', 'jdex', '---\ndescripcion: "A."\njd: "mal"\n---\n# 21.13 A\n'));
    vault.seedNote(fakeNote('n-b', 'jdex', '---\ndescripcion: "B."\njd: "mal"\n---\n# 21.14 B\n'));
    const { api, fake } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, liveHeaders: false } });
    const cleanup = await activateJdex(api);
    void fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_CREATE_ID)!.run();
    expect(document.body.querySelector('dialog.hebra-module-modal')).not.toBeNull();
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    const repair = [...el.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Reparar ('));
    expect(repair?.disabled).toBe(false);
    // The repair's first rebuild waits on a slow library.
    let release: () => void = () => {};
    const original = vault.foldersList.bind(vault);
    vault.foldersList = async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return original();
    };
    repair!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const writes = vault.rewriteCalls.length;
    await cleanup();
    expect(document.body.querySelector('dialog.hebra-module-modal')).toBeNull();
    vault.foldersList = original;
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vault.rewriteCalls.length).toBe(writes);
    expect((await vault.noteRead('n-a'))?.body).toContain('jd: "mal"');
  });

  it('control: without turning it off, the same «Reparar» writes', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    vault.seedNote(fakeNote('n-a', 'jdex', '---\ndescripcion: "A."\njd: "mal"\n---\n# 21.13 A\n'));
    const { api, fake } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, liveHeaders: false } });
    const cleanup = await activateJdex(api);
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    [...el.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Reparar ('))!.click();
    await vi.waitFor(async () => expect((await vault.noteRead('n-a'))?.body).not.toContain('jd: "mal"'));
    await cleanup();
  });
});
