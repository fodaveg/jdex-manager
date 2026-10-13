// @vitest-environment happy-dom
//
// Commands on the ACTIVE note (audit 12 oct 2026, finding 6): `activateJdex` over the fake
// host, in-memory library, real journal. Origin is a CONTENT ID (21.11), not the `.01`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginFolder } from 'hebra-plugin-api/v2';
import {
  JDEX_COMMAND_ARCHIVE_NOTE,
  JDEX_COMMAND_COPY_JD_PATH,
  JDEX_COMMAND_COPY_NOTE_ID,
  JDEX_COMMAND_SEARCH_CATEGORY,
  JDEX_COMMAND_SEND_TO_INBOX
} from '../../src/hebra/jdex-runtime';
import { activateJdex } from './support/activate';
import {
  FAKE_ROOT_FOLDER_ID as ROOT_FOLDER_ID,
  FakeJdexVault,
  createJdexTestApi,
  fakeFolder,
  fakeNote
} from './support/fakes';

let seq = 0;
function folder(name: string, parentId: string | null): PluginFolder {
  seq += 1;
  return fakeFolder(`f${seq}`, parentId, name);
}

function buildFixture() {
  const sistemaArea = folder('00-09 Sistema', ROOT_FOLDER_ID);
  const sistemaCat = folder('00 Sistema', sistemaArea.id);
  const jdexId = folder('00.00 JDex', sistemaCat.id);
  const productosArea = folder('20-29 Productos y servicios', ROOT_FOLDER_ID);
  const productosCat = folder('21 Productos de software propios', productosArea.id);
  const catInbox = folder('21.01 Bandeja de entrada', productosCat.id);
  const archiveId = folder('21.09 Archivo', productosCat.id);
  const hebraId = folder('21.11 Hebra', productosCat.id);
  const loose = folder('Sueltas', ROOT_FOLDER_ID);
  const library = new FakeJdexVault();
  for (const f of [sistemaArea, sistemaCat, jdexId, productosArea, productosCat, catInbox, archiveId, hebraId, loose]) library.seedFolder(f);
  library.seedNote(fakeNote('n-hebra', jdexId.id, ['---', 'jd: 21.11', 'tipo: id', 'descripcion: Notas.', '---', '# 21.11 Hebra', ''].join('\n'), { title: '21.11 Hebra' }));
  library.seedNote(fakeNote('n-content', hebraId.id, '# Idea\n\nTexto.\n', { title: 'Idea', createdAt: new Date(2026, 8, 28).getTime() }));
  library.seedNote(fakeNote('n-loose', loose.id, '# Fuera\n', { title: 'Fuera' }));
  return { library, ids: { jdexId, catInbox, archiveId, hebraId, loose, productosCat } };
}

async function setup() {
  const fixture = buildFixture();
  const { api, fake, workspace } = await createJdexTestApi({ vault: fixture.library });
  await activateJdex(api);
  const run = (id: string) => fake.recorded.commands.find((c) => c.id === id)!.run();
  return { fixture, api, fake, workspace, run };
}

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  seq = 0;
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('commands on the active note', () => {
  it('registers the five commands', async () => {
    const { fake } = await setup();
    const ids = fake.recorded.commands.map((c) => c.id);
    for (const id of [JDEX_COMMAND_SEND_TO_INBOX, JDEX_COMMAND_ARCHIVE_NOTE, JDEX_COMMAND_COPY_NOTE_ID, JDEX_COMMAND_COPY_JD_PATH, JDEX_COMMAND_SEARCH_CATEGORY]) expect(ids).toContain(id);
  });

  it('archives from a content ID into .09 with the date prefix and records it in the undo journal', async () => {
    const { fixture, api, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: fixture.ids.hebraId.id, title: 'Idea' });
    await run(JDEX_COMMAND_ARCHIVE_NOTE);
    const moved = await fixture.library.noteRead('n-content');
    expect(moved?.folderId).toBe(fixture.ids.archiveId.id);
    expect(moved?.title).toMatch(/^2026-09-28 Idea$/);
    const saved = await api.storage.settings.load<{ jdexJournal: { label: string; effects: unknown[] }[] }>();
    expect(saved?.jdexJournal.at(-1)?.label).toBe('Archivar la nota abierta');
    expect(saved?.jdexJournal.at(-1)?.effects.length).toBeGreaterThan(0);
  });

  it('sends a note from a content ID to the .01 of its category', async () => {
    const { fixture, api, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: fixture.ids.hebraId.id, title: 'Idea' });
    await run(JDEX_COMMAND_SEND_TO_INBOX);
    expect((await fixture.library.noteRead('n-content'))?.folderId).toBe(fixture.ids.catInbox.id);
    const saved = await api.storage.settings.load<{ jdexJournal: { label: string }[] }>();
    expect(saved?.jdexJournal.at(-1)?.label).toContain('Enviar nota');
  });

  it('refuses outside an ID with a notice and writes nothing', async () => {
    const { fixture, fake, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-loose', folderId: fixture.ids.loose.id, title: 'Fuera' });
    for (const id of [JDEX_COMMAND_SEND_TO_INBOX, JDEX_COMMAND_ARCHIVE_NOTE, JDEX_COMMAND_COPY_NOTE_ID, JDEX_COMMAND_COPY_JD_PATH, JDEX_COMMAND_SEARCH_CATEGORY]) await run(id);
    expect(fake.recorded.notices.filter((n) => n === 'Esta nota no vive en el sistema JDex.')).toHaveLength(5);
    expect((await fixture.library.noteRead('n-loose'))?.folderId).toBe(fixture.ids.loose.id);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not send or archive the JDex note of the ID itself', async () => {
    const { fixture, fake, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-hebra', folderId: fixture.ids.jdexId.id, title: '21.11 Hebra' });
    await run(JDEX_COMMAND_ARCHIVE_NOTE);
    expect((await fixture.library.noteRead('n-hebra'))?.folderId).toBe(fixture.ids.jdexId.id);
    expect(fake.recorded.notices.some((n) => n.includes('nota JDex del ID'))).toBe(true);
  });

  it('copies the ID and JD text only after a gesture in its own surface', async () => {
    const { fixture, fake, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: fixture.ids.hebraId.id, title: 'Idea' });
    await run(JDEX_COMMAND_COPY_NOTE_ID);
    const copyButton = () => document.querySelector<HTMLButtonElement>('dialog.hebra-module-modal .hebra-jdex-dialog-primary')!;
    expect(document.querySelector<HTMLTextAreaElement>('dialog.hebra-module-modal textarea')?.value).toBe('21.11');
    expect(writeText).not.toHaveBeenCalled();
    copyButton().click();
    await vi.waitFor(() => expect(fake.recorded.notices).toContain('ID copiado.'));
    expect(writeText).toHaveBeenLastCalledWith('21.11');
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
    await run(JDEX_COMMAND_COPY_JD_PATH);
    expect(writeText).toHaveBeenCalledTimes(1);
    copyButton().click();
    await vi.waitFor(() => expect(fake.recorded.notices).toContain('Ruta JD copiada.'));
    const copied = (writeText.mock.calls.at(-1) as unknown as [string])[0];
    expect(copied).toContain('›');
    expect(copied).toContain('21.11 Hebra');
    expect(copied).not.toContain('20-29');
    await run(JDEX_COMMAND_SEARCH_CATEGORY);
    expect(workspace.openSearch).toHaveBeenCalledWith('path:"20-29 Productos y servicios/21 Productos de software propios"');
  });

  it('keeps command copy text selectable when the browser refuses the write', async () => {
    const { fixture, fake, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: fixture.ids.hebraId.id, title: 'Idea' });
    writeText.mockRejectedValueOnce(new Error('denegado'));
    await run(JDEX_COMMAND_COPY_NOTE_ID);
    document.querySelector<HTMLButtonElement>('dialog.hebra-module-modal .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(() => expect(fake.recorded.notices).toContain('No se pudo copiar.'));
    expect(document.querySelector<HTMLTextAreaElement>('dialog.hebra-module-modal textarea')?.value).toBe('21.11');
  });

  it('a note already in .09 is not archived again', async () => {
    const { fixture, fake, workspace, run } = await setup();
    workspace.setActiveNote({ id: 'n-content', folderId: fixture.ids.archiveId.id, title: 'Idea' });
    await run(JDEX_COMMAND_ARCHIVE_NOTE);
    expect(fake.recorded.notices.some((n) => n.startsWith('La nota ya está en'))).toBe(true);
  });
});
