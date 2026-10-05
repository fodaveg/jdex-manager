// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  JDEX_COMMAND_GOTO_ID,
  JDEX_COMMAND_TOGGLE,
  activateJdex
} from '../../src/hebra/jdex-runtime';
import { FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

/** Two children share an ID but have distinct folders and JDex notes. */
function fixture() {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('system', null, '00-09 Sistema'),
    fakeFolder('system-cat', 'system', '00 Sistema'),
    fakeFolder('jdex', 'system-cat', '00.00 JDex'),
    fakeFolder('products', null, '20-29 Productos'),
    fakeFolder('category', 'products', '21 Productos'),
    fakeFolder('parent', 'category', '21.22 JDex Manager'),
    fakeFolder('child-a', 'parent', '+ A'),
    fakeFolder('child-b', 'parent', '+ B')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('parent-note', 'jdex', '# 21.22 JDex Manager\n'));
  vault.seedNote(fakeNote('note-a', 'jdex', '# 21.22+ A #ayuda\n'));
  vault.seedNote(fakeNote('note-b', 'jdex', '# 21.22+ B\n'));
  vault.seedNote(fakeNote('content-a', 'child-a', '# Detalle\n'));
  return vault;
}

afterEach(() => { document.body.replaceChildren(); });

describe('Hebra child navigation and rename guard', () => {
  it('«Ir a» and toggle select A’s folder; toggling content opens A’s JDex note', async () => {
    const { api, fake, workspace } = await createJdexTestApi({ vault: fixture() });
    const cleanup = await activateJdex(api);
    const command = (id: string) => fake.recorded.commands.find((c) => c.id === id)!;
    workspace.setActiveNote({ id: 'note-a', folderId: 'jdex', title: '21.22+ A #ayuda' });
    await command(JDEX_COMMAND_TOGGLE).run();
    expect(workspace.selectFolder).toHaveBeenLastCalledWith('child-a');
    await command(JDEX_COMMAND_GOTO_ID).run();
    const dialog = document.querySelector('dialog.hebra-module-modal')!;
    ([...dialog.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('21.22+ A')) as HTMLElement).click();
    ([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Ir a este ID') as HTMLElement).click();
    expect(workspace.selectFolder).toHaveBeenLastCalledWith('child-a');
    workspace.setActiveNote({ id: 'content-a', folderId: 'child-a', title: 'Detalle' });
    await command(JDEX_COMMAND_TOGGLE).run();
    expect(workspace.openNote).toHaveBeenLastCalledWith('note-a');
    await cleanup();
  });

  it('a child title rename passes the existing guard without borrowing B’s identity', async () => {
    const vault = fixture();
    const { api, workspace } = await createJdexTestApi({ vault });
    const cleanup = await activateJdex(api);
    expect(await workspace.askFolderRename({ kind: 'folder-rename', folderId: 'child-a', newName: '+ Z' })).toBe(true);
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
    expect((await vault.noteRead('note-b'))?.title).toBe('21.22+ B');
    await cleanup();
  });
});
