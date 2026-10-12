// @vitest-environment happy-dom
//
// Every command and built-in action of the Hebra runtime, RUN through `activateJdex` over the
// fake host and the in-memory library: not «it is registered» but its effect on the library,
// its entry in the journal, its error path, and (for queries) that it writes nothing.
// The commands that already have a deep test elsewhere (create ID, normalize all, health,
// undo of a normalization, go to ID, active-note commands) are not repeated here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import {
  JDEX_AUDIT_VIEW_ID,
  JDEX_COMMAND_AUDIT,
  JDEX_COMMAND_CREATE_AREA,
  JDEX_COMMAND_CREATE_CATEGORY,
  JDEX_COMMAND_CREATE_HEADER,
  JDEX_COMMAND_GOTO_ID,
  JDEX_COMMAND_HEALTH,
  JDEX_COMMAND_LOCATE,
  JDEX_COMMAND_NORMALIZE_NOTE,
  JDEX_COMMAND_REFRESH_HEADERS,
  JDEX_COMMAND_REFRESH_INDEX,
  JDEX_COMMAND_REPAIR,
  JDEX_COMMAND_SYSTEM_REPORT,
  JDEX_COMMAND_UNDO,
  JDEX_COMMAND_WRAP_HEADERS
} from '../../src/hebra/jdex-runtime';
import { activateJdex } from './support/activate';
import { FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';
const REPORTS = '00-09 Sistema/00 Sistema/00.02 Informes';
const OPEN_ID = '# 21.11 Hebra\n\nNotas locales.\n';

interface Options {
  /** No reports folder, to see the report commands fail cleanly. */
  withoutReports?: boolean;
  /** No `21.09 Archivo`, so a retired ID keeps its folder. */
  withoutArchive?: boolean;
  headerBody?: string;
}

async function setup(options: Options = {}) {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    ...(options.withoutReports ? [] : [fakeFolder('reports', 'sys-cat', '00.02 Informes')]),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    ...(options.withoutArchive ? [] : [fakeFolder('archive', 'cat', '21.09 Archivo')]),
    fakeFolder('id', 'cat', '21.11 Hebra')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'jdex', `---\njd: "21.11"\ntipo: id\ndescripcion: Notas locales.\n---\n${OPEN_ID}`));
  vault.seedNote(fakeNote('n-header', 'jdex', options.headerBody ?? '# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n'));
  vault.seedNote(fakeNote('n-index', 'jdex', '# 00.00 JDex del sistema\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n'));
  vault.seedNote(fakeNote('n-content', 'id', '# Idea\n'));
  const test = await createJdexTestApi({
    vault,
    settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS }
  });
  const reveal = vi.spyOn(test.api.ui, 'revealView');
  const cleanup = await activateJdex(test.api);
  const command = (id: string) => test.fake.recorded.commands.find((c) => c.id === id)!;
  const journal = async () => (await test.api.storage.settings.load<{ jdexJournal?: { kind: string; label: string }[] }>())?.jdexJournal ?? [];
  const notices = () => test.fake.recorded.notices;
  return { ...test, vault, reveal, cleanup, command, journal, notices };
}

function dialog(): HTMLDialogElement {
  return document.querySelector('dialog.hebra-module-modal')!;
}

function primary(): HTMLButtonElement {
  return dialog().querySelector<HTMLButtonElement>('.hebra-jdex-dialog-primary')!;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function textInputs(): HTMLInputElement[] {
  return [...dialog().querySelectorAll<HTMLInputElement>('input[type="text"]')];
}

async function body(vault: FakeJdexVault, id: string): Promise<string> {
  return (await vault.noteRead(id))?.body ?? '';
}

async function titlesIn(vault: FakeJdexVault, folderId: string): Promise<string[]> {
  return (await vault.notesPage(null, 100, { kind: 'folder', folderId })).items.map((item) => item.title).sort();
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('queries write nothing', () => {
  it('«dónde vive esta nota» says where, or that it is not in the system, and leaves the journal alone', async () => {
    const { command, notices, workspace, journal, vault, cleanup } = await setup();
    const before = vault.rewriteCalls.length;
    await command(JDEX_COMMAND_LOCATE).run();
    expect(notices().at(-1)).toBe('Esta nota no vive en el sistema JDex.');
    workspace.setActiveNote({ id: 'n-content', folderId: 'id', title: 'Idea' });
    await command(JDEX_COMMAND_LOCATE).run();
    expect(notices().at(-1)).toContain('21.11');
    expect(await journal()).toEqual([]);
    expect(vault.rewriteCalls).toHaveLength(before);
    await cleanup();
  });

  it('«auditar el sistema» only reveals the audit view', async () => {
    const { command, reveal, journal, vault, cleanup } = await setup();
    await command(JDEX_COMMAND_AUDIT).run();
    expect(reveal).toHaveBeenCalledWith(JDEX_AUDIT_VIEW_ID);
    expect(await journal()).toEqual([]);
    expect(vault.rewriteCalls).toHaveLength(0);
    await cleanup();
  });

  it('«reparar» rebuilds from the library (it sees a note added outside) and then reveals the audit', async () => {
    const { command, reveal, vault, fake, cleanup } = await setup();
    const status = () => fake.recorded.statusBarItems.find((item) => item.id === 'jdex-audit')?.text;
    const before = status();
    vault.seedNote(fakeNote('n-new', 'jdex', '---\njd: "21.12"\ntipo: id\n---\n# 21.12 Nueva\n'));
    await command(JDEX_COMMAND_REPAIR).run();
    expect(reveal).toHaveBeenCalledWith(JDEX_AUDIT_VIEW_ID);
    expect(status()).not.toBe(before);
    expect(vault.rewriteCalls).toHaveLength(0);
    await cleanup();
  });
});

describe('refresh commands', () => {
  it('«actualizar las listas de cabeceras» writes the managed list, journals it and says so; the second run writes nothing', async () => {
    const { command, vault, notices, journal, cleanup } = await setup();
    await command(JDEX_COMMAND_REFRESH_HEADERS).run();
    await vi.waitFor(async () => expect(await body(vault, 'n-header')).toContain('[[21.11 Hebra]]'));
    expect(notices()).toContain('1 cabecera(s) actualizada(s).');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Actualizar cabeceras']);
    const writes = vault.rewriteCalls.length;
    await command(JDEX_COMMAND_REFRESH_HEADERS).run();
    await vi.waitFor(() => expect(notices().at(-1)).toBe('Ninguna cabecera con marcadores que actualizar.'));
    expect(vault.rewriteCalls).toHaveLength(writes);
    expect(await journal()).toHaveLength(1);
    await cleanup();
  });

  it('«actualizar las listas de cabeceras» with a protected header neither throws nor writes it', async () => {
    const { command, vault, notices, cleanup } = await setup();
    vault.setLocked('n-header', true);
    await command(JDEX_COMMAND_REFRESH_HEADERS).run();
    await vi.waitFor(() => expect(notices().length).toBeGreaterThan(0));
    expect(vault.peekBody('n-header')).toContain('<!-- jdex:hijos -->\n<!-- /jdex:hijos -->');
    await cleanup();
  });

  it('«actualizar el índice del sistema» fills the index note, journals it and is idempotent', async () => {
    const { command, vault, notices, journal, cleanup } = await setup();
    await command(JDEX_COMMAND_REFRESH_INDEX).run();
    await vi.waitFor(async () => expect(await body(vault, 'n-index')).toContain('21.11 Hebra'));
    expect(notices()).toContain('Índice del sistema actualizado.');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Actualizar índice']);
    const writes = vault.rewriteCalls.length;
    await command(JDEX_COMMAND_REFRESH_INDEX).run();
    await vi.waitFor(() => expect(notices().at(-1)).toBe('Sin nota de índice o sin marcadores que actualizar.'));
    expect(vault.rewriteCalls).toHaveLength(writes);
    await cleanup();
  });
});

describe('«envolver las listas de cabeceras en marcadores»', () => {
  const LEGACY = '# 21.10 ■ Cabecera\n\n- [[21.11 Hebra]]\n';

  it('offers the header with a hand-made list, wraps it in markers on Apply and journals it', async () => {
    const { command, vault, journal, cleanup } = await setup({ headerBody: LEGACY });
    void command(JDEX_COMMAND_WRAP_HEADERS).run();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog().textContent).toContain('Cabecera');
    primary().click();
    await vi.waitFor(async () => expect(await body(vault, 'n-header')).toContain('<!-- jdex:hijos -->'));
    await vi.waitFor(() => expect(document.querySelector('dialog.hebra-module-modal')).toBeNull());
    expect((await journal()).map((entry) => entry.label)).toContain('Envolver cabeceras');
    await cleanup();
  });

  it('with nothing to wrap it says so and offers no button', async () => {
    const { command, journal, cleanup } = await setup();
    void command(JDEX_COMMAND_WRAP_HEADERS).run();
    await vi.waitFor(() => expect(dialog().textContent).toContain('Ninguna cabecera necesita marcadores nuevos.'));
    expect(primary()).toBeNull();
    expect(await journal()).toEqual([]);
    await cleanup();
  });

  it('wrapping a header that someone protected meanwhile does not write it', async () => {
    const { command, vault, cleanup } = await setup({ headerBody: LEGACY });
    void command(JDEX_COMMAND_WRAP_HEADERS).run();
    await vi.waitFor(() => expect(primary()).toBeTruthy());
    vault.setLocked('n-header', true);
    primary().click();
    await vi.waitFor(() => expect(vault.peekBody('n-header')).not.toContain('<!-- jdex:hijos -->'));
    await cleanup();
  });
});

describe('«normalizar el frontmatter de esta nota»', () => {
  it('on a content note says it is not a JDex note and opens nothing', async () => {
    const { command, notices, workspace, cleanup } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: 'id', title: 'Idea' });
    await command(JDEX_COMMAND_NORMALIZE_NOTE).run();
    expect(notices().at(-1)).toContain('no es una nota JDex');
    expect(document.querySelector('dialog')).toBeNull();
    await cleanup();
  });

  it('on the JDex note of an ID fixes its frontmatter, journals it, and undo restores the exact body', async () => {
    const { command, vault, workspace, journal, cleanup } = await setup();
    const before = vault.peekBody('n-id');
    workspace.setActiveNote({ id: 'n-id', folderId: 'jdex', title: '21.11 Hebra' });
    await command(JDEX_COMMAND_NORMALIZE_NOTE).run();
    expect(dialog()).toBeTruthy();
    primary().click();
    await vi.waitFor(() => expect(vault.peekBody('n-id')).not.toBe(before));
    expect(vault.peekBody('n-id')).toContain('categoria:');
    expect(vault.peekBody('n-id')).toContain('descripcion: Notas locales.');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Normalizar frontmatter JDex']);
    await vi.waitFor(() => expect(document.querySelector('dialog.hebra-module-modal')).toBeNull());

    await command(JDEX_COMMAND_UNDO).run();
    primary().click();
    await vi.waitFor(() => expect(vault.peekBody('n-id')).toBe(before));
    await cleanup();
  });
});

describe('reports', () => {
  it.each([
    [JDEX_COMMAND_HEALTH, 'Crear informe de salud', /^Salud JD - /u],
    [JDEX_COMMAND_SYSTEM_REPORT, 'Crear informe del sistema', /./u]
  ])('%s creates one note in the reports folder, journals it and opens it', async (commandId, label, title) => {
    const { command, vault, workspace, journal, cleanup } = await setup();
    await command(commandId).run();
    const reports = await titlesIn(vault, 'reports');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(title);
    expect((await journal()).map((entry) => entry.label)).toEqual([label]);
    expect(workspace.openNote).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it.each([JDEX_COMMAND_HEALTH, JDEX_COMMAND_SYSTEM_REPORT])('%s without a reports folder says why and writes nothing', async (commandId) => {
    const { command, vault, workspace, notices, journal, cleanup } = await setup({ withoutReports: true });
    await command(commandId).run();
    expect(notices().length).toBeGreaterThan(0);
    expect(workspace.openNote).not.toHaveBeenCalled();
    expect(await journal()).toEqual([]);
    expect(await titlesIn(vault, 'jdex')).not.toContain(expect.stringMatching(/Salud|Informe/u));
    await cleanup();
  });
});

describe('structure dialogs', () => {
  it('«crear área» creates its JDex note, opens it and journals it; a repeated area is refused', async () => {
    const { command, vault, workspace, journal, cleanup } = await setup();
    void command(JDEX_COMMAND_CREATE_AREA).run();
    const [area, title] = textInputs();
    type(area, '30-39');
    type(title, 'Casa');
    primary().click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalledTimes(1));
    expect(await titlesIn(vault, 'jdex')).toContain('30-39 Casa');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Crear área']);

    void command(JDEX_COMMAND_CREATE_AREA).run();
    const [again, againTitle] = textInputs();
    type(again, '30-39');
    type(againTitle, 'Otra casa');
    expect(primary().disabled).toBe(true);
    expect(dialog().querySelector('.hebra-jdex-dialog-error')?.textContent).not.toBe('');
    expect(await titlesIn(vault, 'jdex')).not.toContain('30-39 Otra casa');
    await cleanup();
  });

  it('«crear categoría» creates it under its area; a taken number is refused with the next free one', async () => {
    const { command, vault, workspace, journal, cleanup } = await setup();
    void command(JDEX_COMMAND_CREATE_CATEGORY).run();
    const select = dialog().querySelector('select')!;
    select.value = '20-29';
    select.dispatchEvent(new Event('change'));
    const [number, title] = textInputs();
    type(number, '21');
    type(title, 'Repetida');
    expect(primary().disabled).toBe(true);
    expect(dialog().querySelector('.hebra-jdex-dialog-error')?.textContent).toContain('21');
    type(number, '22');
    type(title, 'Otras');
    expect(primary().disabled).toBe(false);
    primary().click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalledTimes(1));
    expect(await titlesIn(vault, 'jdex')).toContain('22 Otras');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Crear categoría']);
    await cleanup();
  });

  it('«crear cabecera» creates the header note in its category and journals it', async () => {
    const { command, vault, workspace, journal, cleanup } = await setup();
    void command(JDEX_COMMAND_CREATE_HEADER).run();
    const select = dialog().querySelector('select')!;
    select.value = '21';
    select.dispatchEvent(new Event('change'));
    const [number, , title] = textInputs();
    type(title, 'Herramientas');
    expect(number.value).not.toBe('');
    primary().click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalledTimes(1));
    expect((await titlesIn(vault, 'jdex')).some((name) => name.includes('■ Herramientas'))).toBe(true);
    expect((await journal()).map((entry) => entry.label)).toEqual(['Crear cabecera']);
    await cleanup();
  });
});

describe('the journal command', () => {
  it('with an empty journal opens the dialog without anything to undo', async () => {
    const { command, vault, cleanup } = await setup();
    await command(JDEX_COMMAND_UNDO).run();
    expect(dialog()).toBeTruthy();
    expect(vault.rewriteCalls).toHaveLength(0);
    await cleanup();
  });

  it('refuses to undo when the journal changed after the dialog was opened', async () => {
    const { command, notices, vault, cleanup } = await setup();
    await command(JDEX_COMMAND_REFRESH_INDEX).run();
    // The notice comes after the journal entry is committed: open the dialog only then.
    await vi.waitFor(() => expect(notices()).toContain('Índice del sistema actualizado.'));
    await command(JDEX_COMMAND_UNDO).run();
    await command(JDEX_COMMAND_REFRESH_HEADERS).run();
    await vi.waitFor(() => expect(notices()).toContain('1 cabecera(s) actualizada(s).'));
    primary().click();
    await vi.waitFor(() => expect(notices().join(' | ')).toContain('El diario cambió'));
    expect(await body(vault, 'n-index')).toContain('21.11 Hebra');
    await cleanup();
  });
});

describe('built-in actions of «ir a un ID»', () => {
  async function openActions(options: Options = {}, label = '21.11 Hebra') {
    const test = await setup(options);
    void test.command(JDEX_COMMAND_GOTO_ID).run();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    (
      [...dialog().querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes(label))
    )!.click();
    const action = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.hebra-jdex-goto-action')].find((b) => b.textContent === name)!;
    return { ...test, action };
  }

  const folderOf = async (vault: FakeJdexVault, id: string) => (await vault.foldersList()).find((f) => f.id === id)!;

  it('retire (confirmed): marks the JDex note, moves the folder into 21.09 with the date, keeps the number, journals it, and undo puts everything back', async () => {
    const { action, vault, notices, journal, command, cleanup } = await openActions();
    const noteBefore = vault.peekBody('n-id');
    action('Retirar este ID').click();
    primary().click();
    await vi.waitFor(() => expect(notices().join(' | ')).toContain('retirado: movido a su archivo'));

    expect(vault.peekBody('n-id')).toContain('tipo: "archivado"');
    expect(vault.peekBody('n-id')).toContain('archivado:');
    const folder = await folderOf(vault, 'id');
    expect(folder.parentId).toBe('archive');
    expect(folder.name).toMatch(/^\d{4}-\d{2}-\d{2} 21\.11 Hebra$/u);
    // The ID is never renumbered or reused: still 21.11 in the note and in its title.
    expect((await vault.noteRead('n-id'))?.title).toBe('21.11 Hebra');
    expect((await journal()).map((entry) => entry.label)).toEqual(['Retirar 21.11 Hebra']);

    await command(JDEX_COMMAND_UNDO).run();
    primary().click();
    await vi.waitFor(() => expect(notices().some((text) => /paso\(s\) deshecho\(s\)\./u.test(text))).toBe(true));
    await vi.waitFor(async () => expect((await folderOf(vault, 'id')).parentId).toBe('cat'));
    expect((await folderOf(vault, 'id')).name).toBe('21.11 Hebra');
    await vi.waitFor(() => expect(vault.peekBody('n-id')).toBe(noteBefore));
    await cleanup();
  });

  it('retire without a 21.09 archive marks the note but leaves the folder where it was, and says so', async () => {
    const { action, vault, notices, cleanup } = await openActions({ withoutArchive: true });
    action('Retirar este ID').click();
    primary().click();
    await vi.waitFor(() => expect(notices().some((text) => text.includes('la carpeta se queda donde estaba'))).toBe(true));
    expect(vault.peekBody('n-id')).toContain('tipo: "archivado"');
    expect((await folderOf(vault, 'id')).parentId).toBe('cat');
    await cleanup();
  });

  it('retire of a protected JDex note says why and changes neither the note nor the folder', async () => {
    const { action, vault, notices, journal, cleanup } = await openActions();
    vault.setLocked('n-id', true);
    action('Retirar este ID').click();
    primary().click();
    await vi.waitFor(() => expect(notices().length).toBeGreaterThan(0));
    expect(vault.peek('n-id').locked).toBe(true);
    expect((await folderOf(vault, 'id')).parentId).toBe('cat');
    expect(await journal()).toEqual([]);
    await cleanup();
  });

  it('«Copiar ID» copies the ID of the entry and closes the dialog', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { action, notices, cleanup } = await openActions();
    action('Copiar ID').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('21.11'));
    expect(notices()).toContain('ID copiado.');
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
    await cleanup();
  });

  it('«Copiar ID» fails softly when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denegado'); }) }, configurable: true });
    const { action, notices, cleanup } = await openActions();
    action('Copiar ID').click();
    await vi.waitFor(() => expect(notices()).toContain('No se pudo copiar.'));
    await cleanup();
  });

  it('«Mover la nota abierta aquí» is disabled without an open note', async () => {
    const { action, vault, cleanup } = await openActions();
    expect(action('Mover la nota abierta aquí').disabled).toBe(true);
    expect(vault.peek('n-content').folderId).toBe('id');
    await cleanup();
  });
});

describe('«Mover la nota abierta aquí» keeps the identity of each system (D01 / D02)', () => {
  async function twoSystems() {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('jdex', null, 'JDex'),
      fakeFolder('loose', null, 'Sueltas'),
      fakeFolder('d01-area', null, 'D01.20-29 Trabajo'),
      fakeFolder('d01-cat', 'd01-area', 'D01.21 Productos'),
      fakeFolder('d01-id', 'd01-cat', 'D01.21.11 Uno'),
      fakeFolder('d02-area', null, 'D02.20-29 Casa'),
      fakeFolder('d02-cat', 'd02-area', 'D02.21 Hogar'),
      fakeFolder('d02-id', 'd02-cat', 'D02.21.11 Dos')
    ]) vault.seedFolder(folder);
    vault.seedNote(fakeNote('n-d01', 'jdex', '# D01.21.11 Uno\n'));
    vault.seedNote(fakeNote('n-d02', 'jdex', '# D02.21.11 Dos\n'));
    vault.seedNote(fakeNote('n-loose', 'loose', '# Suelta\n'));
    const test = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: 'JDex', systemRoot: '' } });
    await activateJdex(test.api);
    test.workspace.setActiveNote({ id: 'n-loose', folderId: 'loose', title: 'Suelta' });
    const command = (id: string) => test.fake.recorded.commands.find((c) => c.id === id)!;
    const moveTo = async (label: string) => {
      void command(JDEX_COMMAND_GOTO_ID).run();
      await vi.waitFor(() => expect(dialog()).toBeTruthy());
      [...dialog().querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes(label))!.click();
      [...document.querySelectorAll<HTMLButtonElement>('.hebra-jdex-goto-action')].find((b) => b.textContent === 'Mover la nota abierta aquí')!.click();
    };
    return { ...test, vault, command, moveTo };
  }

  it.each([
    ['D01.21.11', 'd01-id'],
    ['D02.21.11', 'd02-id']
  ])("moving to %s lands in that system's folder, not in the other one with the same number", async (label, folderId) => {
    const { vault, moveTo, fake, api } = await twoSystems();
    await moveTo(label);
    await vi.waitFor(() => expect(vault.peek('n-loose').folderId).toBe(folderId));
    expect(fake.recorded.notices.some((text) => text.startsWith('Movida a'))).toBe(true);
    const stored = await api.storage.settings.load<{ jdexJournal: { label: string }[] }>();
    expect(stored?.jdexJournal.map((entry) => entry.label)).toEqual([expect.stringContaining('Mover nota a')]);
  });

  it('undo returns the note to the folder it came from', async () => {
    const { vault, moveTo, command } = await twoSystems();
    await moveTo('D02.21.11');
    await vi.waitFor(() => expect(vault.peek('n-loose').folderId).toBe('d02-id'));
    await command(JDEX_COMMAND_UNDO).run();
    primary().click();
    await vi.waitFor(() => expect(vault.peek('n-loose').folderId).toBe('loose'));
  });

  it('a note that disappeared meanwhile reports the error and journals nothing', async () => {
    const { vault, moveTo, fake, api } = await twoSystems();
    vault.purge('n-loose');
    await moveTo('D01.21.11');
    await vi.waitFor(() => expect(fake.recorded.notices.length).toBeGreaterThan(0));
    expect(fake.recorded.notices.some((text) => text.startsWith('Movida a'))).toBe(false);
    const stored = await api.storage.settings.load<{ jdexJournal?: unknown[] }>();
    expect(stored?.jdexJournal ?? []).toEqual([]);
  });
});
