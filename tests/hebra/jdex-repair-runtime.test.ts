// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateJdex, JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_REPAIR, JDEX_COMMAND_UNDO } from '../../src/hebra/jdex-runtime';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('Hebra repair preview and journal', () => {
  it('keeps structure notes opt-in and requires selecting their unchecked preview rows', async () => {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
      fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('area', null, '20-29 Productos'),
      fakeFolder('cat', 'area', '21 Software')
    ]) vault.seedFolder(folder);
    const { api, fake } = await createJdexTestApi({ vault, settings: { structureNotesAreFindings: true } });
    const deactivate = await activateJdex(api);
    const el = document.createElement('div');
    document.body.append(el);
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    const row = [...el.querySelectorAll('li')].find((item) => item.textContent?.includes('La categoría 21 Software no tiene nota'))!;
    const checkbox = row.querySelector<HTMLInputElement>('.hebra-jdex-repair-select')!;
    expect(checkbox.checked).toBe(false);
    expect((await vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' })).items).toEqual([]);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    el.querySelector<HTMLButtonElement>('.hebra-jdex-repair-apply')!.click();
    await vi.waitFor(async () => expect((await vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' })).items.some((note) => note.title === '21 Software')).toBe(true));
    await vi.waitFor(async () => {
      const saved = await api.storage.settings.load<{ jdexJournal: { label: string; effects: unknown[] }[] }>();
      expect(saved?.jdexJournal.at(-1)?.label).toBe('Reparar JDex');
    });
    await deactivate();
  });

  it('reaudits, applies two selected types, and undoes both as one operation', async () => {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
      fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('area', null, '20-29 Productos'),
      fakeFolder('cat', 'area', '21 Software'), fakeFolder('id', 'cat', '21.11 Antes')
    ]) vault.seedFolder(folder);
    const before = '# 21.11 Después\n\nDescripción existente.\n';
    vault.seedNote(fakeNote('n1', 'jdex', before));
    const { api, fake } = await createJdexTestApi({ vault });
    const deactivate = await activateJdex(api);
    expect(fake.recorded.commands.some((command) => command.id === JDEX_COMMAND_REPAIR)).toBe(true);
    const el = document.createElement('div');
    document.body.append(el);
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    const rename = [...el.querySelectorAll('li')].find((row) => row.textContent?.includes('la nota se llama'))!;
    expect(el.textContent).not.toContain('El área');
    expect(el.textContent).not.toContain('La categoría');
    expect((await vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' })).items.map((note) => note.title)).toEqual(['21.11 Después']);
    const checkbox = rename.querySelector<HTMLInputElement>('.hebra-jdex-repair-select')!;
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    el.querySelector<HTMLButtonElement>('.hebra-jdex-repair-apply')!.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Después'));
    await vi.waitFor(async () => expect((await vault.noteRead('n1'))?.body).toContain('jd:'));
    const saved = await api.storage.settings.load<{ jdexJournal: { label: string; effects: unknown[] }[] }>();
    expect(saved?.jdexJournal.at(-1)?.label).toBe('Reparar JDex');
    expect(saved?.jdexJournal.at(-1)?.effects.length).toBeGreaterThanOrEqual(2);
    await fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_UNDO)!.run();
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Antes'));
    expect((await vault.noteRead('n1'))?.body).toBe(before);
    await deactivate();
  });
});
