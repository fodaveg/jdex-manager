// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { activateJdex, JDEX_AUDIT_VIEW_ID, JDEX_COMMAND_CREATE_ID, JDEX_COMMAND_HEALTH, JDEX_COMMAND_NORMALIZE_ALL, JDEX_COMMAND_UNDO } from '../../src/hebra/jdex-runtime';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';
import { jdexNoteFileStem } from '../../src/hebra/library-index';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';
const REPORTS = '00-09 Sistema/00 Sistema/00.02 Informes';

async function setup(oldTitle = '21.11 Antes') {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('reports', 'sys-cat', '00.02 Informes'),
    fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', jdexNoteFileStem(oldTitle)),
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', `# ${oldTitle} #claude\n\nDescripción.\n`));
  vault.seedNote(fakeNote('n-header', 'jdex', '# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n'));
  vault.seedNote(fakeNote('n-index', 'jdex', '# 00.00 JDex del sistema\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n'));
  const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS, subfolderPattern: '70 Adjuntos' } });
  const cleanup = await activateJdex(api);
  return { vault, api, fake, workspace, cleanup };
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('L7 runtime Hebra', () => {
  it('tras crear un ID reconstruye una vez y no relee cuerpos JDex sin cambios', async () => {
    const { vault, fake, workspace, cleanup } = await setup();
    const noteRead = vi.spyOn(vault, 'noteRead');
    const summaries = vi.spyOn(vault, 'noteSummary');
    await fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_CREATE_ID)!.run();
    const dialog = document.querySelector('dialog')!;
    const title = dialog.querySelectorAll<HTMLInputElement>('input[type="text"]')[1];
    title.value = 'Nueva';
    title.dispatchEvent(new Event('input'));
    for (const checkbox of dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
    }
    dialog.querySelector<HTMLButtonElement>('.hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalledTimes(1));
    expect(summaries.mock.calls.filter(([ids]) => ids.length === 4)).toHaveLength(1);
    expect(noteRead.mock.calls.filter(([id]) => id === 'n-id')).toHaveLength(0);
    await cleanup();
  });

  it('muestra el patrón que falta en auditoría', async () => {
    const { fake, cleanup } = await setup();
    const el = document.createElement('div');
    fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
    expect(el.textContent).toContain('70 Adjuntos');
    await cleanup();
  });

  it('ofrece renombrar carpeta tras el cambio de título, conserva etiquetas y permite deshacer', async () => {
    const { vault, workspace, fake, cleanup } = await setup();
    vault.saveElsewhere('n-id', '# 21.11 Después #claude\n\nDescripción.\n');
    workspace.emitTitleRenamed({ noteId: 'n-id', folderId: 'jdex', oldTitle: '21.11 Antes #claude', newTitle: '21.11 Después #claude', undo: vi.fn() });
    expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Antes');
    const rename = document.querySelector<HTMLButtonElement>('.hebra-module-notice button')!;
    expect(rename.textContent).toContain('Renombrar carpeta');
    rename.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Después'));
    expect((await vault.noteRead('n-id'))?.title).toBe('21.11 Después #claude');
    await vi.waitFor(() => expect(vault.rewriteCalls.length).toBeGreaterThan(0));
    await fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_UNDO)!.run();
    const undo = document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!;
    expect(document.querySelector('dialog')?.textContent).toContain('Renombrar carpeta');
    undo.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Antes'));
    expect((await vault.noteRead('n-id'))?.title).toBe('21.11 Después #claude');
    await cleanup();
  });

  it('canonicaliza ambos títulos con separadores al proponer el renombrado de carpeta', async () => {
    const { vault, workspace, cleanup } = await setup('21.11 Antes/con barra');
    vault.saveElsewhere('n-id', '# 21.11 Después/otra barra #claude\n');
    workspace.emitTitleRenamed({ noteId: 'n-id', folderId: 'jdex', oldTitle: '21.11 Antes/con barra #claude', newTitle: '21.11 Después/otra barra #claude', undo: vi.fn() });
    const rename = document.querySelector<HTMLButtonElement>('.hebra-module-notice button')!;
    expect(rename.textContent).toContain('Renombrar carpeta');
    expect(rename.textContent).toContain('21.11 Después–otra barra');
    rename.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Después–otra barra'));
    expect((await vault.noteRead('n-id'))?.title).toBe('21.11 Después/otra barra #claude');
    await cleanup();
  });

  it('no renombra una carpeta que cambió desde el aviso', async () => {
    const { vault, workspace, cleanup } = await setup();
    vault.saveElsewhere('n-id', '# 21.11 Después #claude\n');
    workspace.emitTitleRenamed({ noteId: 'n-id', folderId: 'jdex', oldTitle: '21.11 Antes #claude', newTitle: '21.11 Después #claude', undo: vi.fn() });
    await vault.folderRename('id', '21.11 Manual');
    document.querySelector<HTMLButtonElement>('.hebra-module-notice button')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('cambió desde el aviso'));
    expect((await vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.11 Manual');
    await cleanup();
  });

  it('pone cabeceras e índice al día tras cambios manuales, sin escribir de nuevo en un aviso repetido', async () => {
    const { vault, workspace, cleanup } = await setup();
    vi.useFakeTimers();
    vault.saveElsewhere('n-id', '# 21.11 Manual #claude\n\nDescripción.\n');
    workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-header'))?.body).toContain('[[21.11 Manual #claude]]');
    expect((await vault.noteRead('n-index'))?.body).toContain('21.11 Manual #claude');
    const writes = vault.rewriteCalls.length;
    workspace.emitNotes({ ids: ['n-header', 'n-index'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(vault.rewriteCalls).toHaveLength(writes);
    await cleanup();
  });

  it('crea un informe nuevo cada vez en informes y lo abre sin reemplazar el anterior', async () => {
    const { vault, api, fake, workspace, cleanup } = await setup();
    const command = fake.recorded.commands.find((entry) => entry.id === JDEX_COMMAND_HEALTH)!;
    await command.run();
    await command.run();
    expect(workspace.openNote).toHaveBeenCalledTimes(2);
    const [first, second] = (workspace.openNote as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      const note = await vault.noteRead(id);
      expect(note?.folderId).toBe('reports');
      expect(note?.title).toMatch(/^Salud JD - /);
      expect(note?.body).toContain('## Ocupación por categoría');
    }
    const stored = await api.storage.settings.load<{ jdexJournal: { label: string }[] }>();
    expect(stored?.jdexJournal.map((entry) => entry.label)).toEqual(['Crear informe de salud', 'Crear informe de salud']);
    await cleanup();
  });

  it('normalizar registra escrituras, conserva ajustes y deshace cuerpos mediante el diálogo', async () => {
    const { vault, api, fake, cleanup } = await setup();
    const before = (await vault.noteRead('n-id'))!.body;
    await fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_NORMALIZE_ALL)!.run();
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(async () => expect((await vault.noteRead('n-id'))?.body).toContain('categoria:'));
    await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    const stored = await api.storage.settings.load<{ jdexFolder: string; jdexJournal: unknown[] }>();
    expect(stored?.jdexFolder).toBe(JDEX);
    expect(Array.isArray(stored?.jdexJournal)).toBe(true);
    await fake.recorded.commands.find((command) => command.id === JDEX_COMMAND_UNDO)!.run();
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(async () => expect((await vault.noteRead('n-id'))?.body).toBe(before));
    await cleanup();
  });
});
