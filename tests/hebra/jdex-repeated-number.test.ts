// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026 (write integrity), finding 3, Hebra: two notes with the same title
 * keep two technical identities (distinct paths in the walk, both openable), and actions
 * on a repeated number are refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_GOTO_ID } from '../../src/hebra/jdex-runtime';
import { walkJdexLibrary } from '../../src/hebra/library-index';
import { activateJdex } from './support/activate';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote, FAKE_ROOT_FOLDER_ID } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';

function seed(vault: FakeJdexVault): void {
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', '21.23 Alfa')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-alfa-1', 'jdex', '---\ndescripcion: "Uno."\n---\n# 21.23 Alfa\n'));
  vault.seedNote(fakeNote('n-alfa-2', 'jdex', '---\ndescripcion: "Dos."\n---\n# 21.23 Alfa\n'));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Hebra: same-title notes keep separate identities (37c115ca)', () => {
  it('the walk gives two notes with the same title two distinct paths', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const walk = await walkJdexLibrary(vault, await vault.foldersList(), '', FAKE_ROOT_FOLDER_ID);
    const paths = walk.systemNotes.filter((note) => note.title === '21.23 Alfa').map((note) => note.path);
    expect(new Set(paths).size).toBe(2);
    expect(paths).toContain(`${JDEX}/21.23 Alfa.md`);
    expect(walk.noteIdByPath?.get(paths[0])).not.toBe(walk.noteIdByPath?.get(paths[1]));
  });

  it('the duplicate-id finding lists both notes and both open', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
    const cleanup = await activateJdex(api);
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    expect(el.textContent).toContain('21.23 está repetido en 2 notas');
    expect(el.textContent).not.toContain('la nota se llama');
    const links = [...el.querySelectorAll('button, a')].filter((node) => node.textContent?.includes('21.23 Alfa') && node.textContent.endsWith('.md'));
    for (const link of links) (link as HTMLElement).click();
    expect(new Set(workspace.openNote.mock.calls.map(([id]) => id))).toEqual(new Set(['n-alfa-1', 'n-alfa-2']));
    await cleanup();
  });

  it('retiring a repeated number from «Ir a un ID» is refused', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { api, fake } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
    const cleanup = await activateJdex(api);
    void fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_GOTO_ID)!.run();
    const before = vault.rewriteCalls.length;
    const option = [...document.body.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes('21.23 Alfa'));
    (option as HTMLButtonElement).click();
    const retire = [...document.body.querySelectorAll('.hebra-jdex-goto-action')].find((button) => button.textContent === 'Retirar este ID') as HTMLButtonElement | undefined;
    expect(retire).toBeTruthy();
    retire!.click();
    expect(fake.recorded.notices.some((notice) => notice.includes('21.23 está repetido'))).toBe(true);
    expect(document.body.textContent).not.toContain('se retira');
    expect(vault.rewriteCalls.length).toBe(before);
    await cleanup();
  });
});

describe('Hebra: folder-to-note paired rename on a repeated number (37c115ca)', () => {
  async function renameFolder(notes: { id: string; title: string }[]) {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'),
      fakeFolder('sys-cat', 'sys', '00 Sistema'),
      fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
      fakeFolder('area', null, '20-29 Productos'),
      fakeFolder('cat', 'area', '21 Software'),
      fakeFolder('id', 'cat', '21.23 Alfa')
    ]) vault.seedFolder(folder);
    for (const note of notes) vault.seedNote(fakeNote(note.id, 'jdex', `---\ndescripcion: "x"\n---\n# ${note.title}\n`));
    const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, renamePairsWithoutAsking: true } });
    const cleanup = await activateJdex(api);
    expect(await workspace.changeFolderAsHost(vault, { kind: 'folder-rename', folderId: 'id', newName: '21.23 Alfa nueva' })).toBe(true);
    workspace.emitFolders(await vault.foldersList());
    return { vault, fake, cleanup };
  }

  it('the folder is renamed but its note does not follow, with a notice', async () => {
    const { vault, fake, cleanup } = await renameFolder([{ id: 'n-alfa', title: '21.23 Alfa' }, { id: 'n-beta', title: '21.23 Beta' }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await vault.noteRead('n-alfa'))?.title).toBe('21.23 Alfa');
    expect((await vault.noteRead('n-beta'))?.title).toBe('21.23 Beta');
    expect(fake.recorded.notices.some((notice) => notice.includes('21.23 está repetido'))).toBe(true);
    expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.23 Alfa nueva');
    await cleanup();
  });

  it('control: with a unique number the note follows the folder', async () => {
    const { vault, fake, cleanup } = await renameFolder([{ id: 'n-alfa', title: '21.23 Alfa' }]);
    await vi.waitFor(async () => expect((await vault.noteRead('n-alfa'))?.title).toBe('21.23 Alfa nueva'));
    expect(fake.recorded.notices.some((notice) => notice.includes('está repetido'))).toBe(false);
    await cleanup();
  });
});
