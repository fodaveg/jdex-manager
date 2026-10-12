// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026, 5.2 (task 9d339311): the create dialogs through the real runtime.
 * Turning the module off while a submit is in flight writes nothing and fails with the
 * shutdown notice, not with a `null` walk or index (the cleanup does not empty them).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { JDEX_DISPOSED_MESSAGE } from '../../src/hebra/jdex-lifecycle';
import { JDEX_COMMAND_CREATE_CHILD, JDEX_COMMAND_CREATE_HEADER, JDEX_COMMAND_CREATE_ID } from '../../src/hebra/jdex-runtime';
import { activateJdex } from './support/activate';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';

async function setup() {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '---\ndescripcion: "Algo."\n---\n# 21.11 Algo\n'));
  const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, liveHeaders: false } });
  const cleanup = await activateJdex(harness.api);
  return { ...harness, vault, cleanup };
}

function openDialog(fake: Awaited<ReturnType<typeof setup>>['fake'], id: string): HTMLDialogElement {
  void fake.recorded.commands.find((command) => command.id === id)!.run();
  return document.body.querySelector('dialog.hebra-module-modal') as HTMLDialogElement;
}

function fill(dialog: HTMLDialogElement, index: number, value: string): void {
  const input = [...dialog.querySelectorAll('input[type="text"]')][index] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

const notices = (): string[] => [...document.body.querySelectorAll('.hebra-module-notice')].map((el) => el.textContent ?? '');

async function jdexTitles(vault: FakeJdexVault): Promise<string[]> {
  const page = await vault.notesPage(null, 100, { kind: 'folder', folderId: 'jdex' });
  return page.items.map((item) => item.title).sort();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Hebra: turning the module off with a create dialog in flight (4bb96884)', () => {
  for (const [label, command, fields] of [
    ['header', JDEX_COMMAND_CREATE_HEADER, [[2, 'Bloque']]],
    ['ID', JDEX_COMMAND_CREATE_ID, [[1, 'Nuevo']]]
  ] as const) {
    it(`${label}: a submit that lands after the cleanup writes nothing and says why`, async () => {
      const { vault, fake, cleanup } = await setup();
      const dialog = openDialog(fake, command);
      for (const [index, value] of fields) fill(dialog, index, value);
      const before = await jdexTitles(vault);
      (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
      // The dialog is re-reading the index; the module is turned off meanwhile.
      await cleanup();
      await vi.waitFor(() => expect(notices()).toContain(JDEX_DISPOSED_MESSAGE));
      expect(await jdexTitles(vault)).toEqual(before);
      expect(notices().join('\n')).not.toMatch(/null|undefined/);
    });
  }

  it('control: without turning it off, the same header submit creates the note', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_HEADER);
    fill(dialog, 2, 'Bloque');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    expect(await jdexTitles(vault)).toContain('00.10 ■ Bloque');
    await cleanup();
  });

  it('child: the dialog needs the parent note open, and the same shutdown writes nothing', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    workspace.setActiveNote({ id: 'n-id', title: '21.11 Algo', folderId: 'jdex' });
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_CHILD);
    fill(dialog, 0, 'Hijo');
    const before = await jdexTitles(vault);
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await cleanup();
    await vi.waitFor(() => expect(notices()).toContain(JDEX_DISPOSED_MESSAGE));
    expect(await jdexTitles(vault)).toEqual(before);
  });
});

/** Like `setup`, plus a templates folder and a hook to change the settings as another tab
 *  or device would (`storage.settings.onChange`, a no-op in the package's fake host). */
async function setupLive(extra: Record<string, unknown> = {}) {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('tpl', null, 'Plantillas')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', '---\ndescripcion: "Algo."\n---\n# 21.11 Algo\n'));
  const stored = { ...DEFAULT_SETTINGS, jdexFolder: JDEX, liveHeaders: false, templatesFolder: 'Plantillas', ...extra };
  const harness = await createJdexTestApi({ vault, settings: stored });
  let settingsListener: (value: unknown) => void = () => {};
  (harness.api.storage.settings as { onChange: unknown }).onChange = (listener: (value: unknown) => void) => {
    settingsListener = listener;
    return () => {};
  };
  const cleanup = await activateJdex(harness.api);
  return { ...harness, vault, cleanup, stored, changeSettings: (value: unknown) => settingsListener(value) };
}

describe('Hebra: create dialogs revalidate the library before writing (7277a468)', () => {
  it('a template another device created a moment ago (notice still pending) is used', async () => {
    const { vault, fake, workspace, cleanup } = await setupLive();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_ID);
    fill(dialog, 1, 'Nuevo');
    vault.seedNote(fakeNote('t-id', 'tpl', '# JDex - id\n\nCUERPO DE PLANTILLA\n'));
    workspace.emitNotes({ ids: ['t-id'], reason: 'sync' });
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    const created = await vault.noteRead(workspace.openNote.mock.calls[0][0]);
    expect(created?.body).toContain('CUERPO DE PLANTILLA');
    await cleanup();
  });

  it('the creation system is the one chosen at opening, even if the settings change before writing', async () => {
    const { vault, fake, workspace, cleanup, stored, changeSettings } = await setupLive({ systemId: 'D01' });
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_ID);
    fill(dialog, 1, 'Nuevo');
    changeSettings({ ...stored, prefixNamesWithSystem: true });
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    const created = await vault.noteRead(workspace.openNote.mock.calls[0][0]);
    expect(created?.title).toMatch(/^00\.\d\d Nuevo$/);
    await cleanup();
  });
});
