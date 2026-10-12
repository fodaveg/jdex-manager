// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026, finding 6: creating a category or an area revalidates the number
 * against the live library at confirm time, also when another device used another title.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { JDEX_COMMAND_CREATE_AREA, JDEX_COMMAND_CREATE_CATEGORY } from '../../src/hebra/jdex-runtime';
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
  vault.seedNote(fakeNote('n-id', 'jdex', '# 21.11 Algo\n'));
  const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
  const cleanup = await activateJdex(harness.api);
  return { ...harness, vault, cleanup };
}

function openDialog(fake: Awaited<ReturnType<typeof setup>>['fake'], id: string): HTMLDialogElement {
  void fake.recorded.commands.find((command) => command.id === id)!.run();
  return document.body.querySelector('dialog.hebra-module-modal') as HTMLDialogElement;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function titles(vault: FakeJdexVault): Promise<string[]> {
  const page = await vault.notesPage(null, 100, { kind: 'folder', folderId: 'jdex' });
  return page.items.map((item) => item.title).sort();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Hebra: create category and area revalidate the number at confirm (8cb1a450)', () => {
  it('category: a number taken from another device under another title is rejected and the next free proposed', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_CATEGORY);
    const select = dialog.querySelector('select') as HTMLSelectElement;
    select.value = '20';
    select.dispatchEvent(new Event('change'));
    const [number, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    expect(number.value).toBe('22');
    type(title, 'Mía');
    vault.seedNote(fakeNote('n-other', 'jdex', '# 22 De otro dispositivo\n'));
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(dialog.querySelector('.hebra-jdex-dialog-error')?.textContent).toContain('Siguiente libre: 23'));
    expect(number.value).toBe('23');
    expect(await titles(vault)).not.toContain('22 Mía');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    expect(await titles(vault)).toContain('23 Mía');
    await cleanup();
  });

  it('category control: without a conflict the first confirm creates it', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_CATEGORY);
    const select = dialog.querySelector('select') as HTMLSelectElement;
    select.value = '20';
    select.dispatchEvent(new Event('change'));
    const [, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    type(title, 'Mía');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    expect(await titles(vault)).toContain('22 Mía');
    await cleanup();
  });

  it('area: a number taken from another device under another title is rejected and the next free proposed', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_AREA);
    const [number, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    expect(number.value).toBe('10-19');
    type(title, 'Mía');
    vault.seedNote(fakeNote('n-other', 'jdex', '# 10-19 De otro dispositivo\n'));
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(dialog.querySelector('.hebra-jdex-dialog-error')?.textContent).toContain('Siguiente libre: 30-39'));
    expect(number.value).toBe('30-39');
    expect(await titles(vault)).not.toContain('10-19 Mía');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    expect(await titles(vault)).toContain('30-39 Mía');
    await cleanup();
  });

  it('area control: without a conflict the first confirm creates it', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const dialog = openDialog(fake, JDEX_COMMAND_CREATE_AREA);
    const [, title] = [...dialog.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    type(title, 'Mía');
    (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());
    expect(await titles(vault)).toContain('10-19 Mía');
    await cleanup();
  });
});
