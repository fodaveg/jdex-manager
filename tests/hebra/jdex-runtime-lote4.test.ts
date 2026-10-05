// @vitest-environment happy-dom
//
// El lote 4 («Procesar inbox» y la sección del ID en el panel de contexto) de
// extremo a extremo: `activateJdex(api)` sobre el host falso del paquete
// (`createFakePluginApi`, que registra comandos, vistas y piezas de la barra), diálogo
// montado de verdad en el DOM (`support/fakes.ts`) y biblioteca en memoria
// (`FakeJdexVault`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginFolder } from 'hebra-plugin-api';
import {
  JDEX_COMMAND_PROCESS_INBOX,
  JDEX_ID_SECTION_VIEW_ID,
  JDEX_STATUS_INBOX_ID,
  activateJdex
} from '../../src/hebra/jdex-runtime';
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

/** `00-09/00/00.00 JDex` con `21.11 Hebra` (con descripción) y `21 Productos de
 *  software`, con `21.01 Bandeja de entrada` (dos notas sueltas) y `21.11 Hebra` como
 *  único ID de contenido. */
function buildFixture() {
  const sistemaArea = folder('00-09 Sistema', ROOT_FOLDER_ID);
  const sistemaCat = folder('00 Sistema', sistemaArea.id);
  const jdexId = folder('00.00 JDex', sistemaCat.id);
  const productosArea = folder('20-29 Productos y servicios', ROOT_FOLDER_ID);
  const productosCat = folder('21 Productos de software propios', productosArea.id);
  const catInbox = folder('21.01 Bandeja de entrada', productosCat.id);
  const hebraId = folder('21.11 Hebra', productosCat.id);
  const archiveId = folder('21.09 Archivo', productosCat.id);

  const folders: PluginFolder[] = [
    sistemaArea,
    sistemaCat,
    jdexId,
    productosArea,
    productosCat,
    catInbox,
    archiveId,
    hebraId
  ];

  const library = new FakeJdexVault();
  for (const f of folders) {
    library.seedFolder(f);
  }

  library.seedNote(
    fakeNote(
      'n-hebra',
      jdexId.id,
      [
        '---',
        'jd: 21.11',
        'tipo: id',
        'descripcion: Notas Markdown local-first.',
        '---',
        '# 21.11 Hebra',
        ''
      ].join('\n')
    )
  );
  library.seedNote(fakeNote('n-inbox-1', catInbox.id, '# 2026-09-28 Suelta 1\n'));
  library.seedNote(fakeNote('n-inbox-2', catInbox.id, '# 2026-09-28 Suelta 2\n'));

  return { folders, library, ids: { jdexId, productosCat, catInbox, hebraId, archiveId } };
}

async function setup(fixture: ReturnType<typeof buildFixture>) {
  const { api, fake, workspace } = await createJdexTestApi({ vault: fixture.library });
  return { api, fake, workspace };
}

function findCommand(fake: Awaited<ReturnType<typeof setup>>['fake'], id: string) {
  const command = fake.recorded.commands.find((c) => c.id === id);
  if (!command) throw new Error(`comando no registrado: ${id}`);
  return command;
}

afterEach(() => {
  document.body.replaceChildren();
});

beforeEach(() => {
  seq = 0;
});

describe('activate — lote 4, «Procesar inbox»', () => {
  it('el comando y el clic en «Inbox: N» abren el mismo diálogo, con las dos notas', async () => {
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);
    
    expect(fake.recorded.commands.map((c) => c.id)).toContain(JDEX_COMMAND_PROCESS_INBOX);

    void findCommand(fake, JDEX_COMMAND_PROCESS_INBOX).run();
    let dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    expect(dialog.textContent).toContain('Suelta 1');
    expect(dialog.textContent).toContain('2 nota(s) por procesar.');
    dialog.remove();

    const inbox = fake.recorded.statusBarItems.find((item) => item.id === JDEX_STATUS_INBOX_ID)!;
    expect(inbox.text).toBe('Inbox: 2');
    inbox.onClick?.();
    dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    expect(dialog.textContent).toContain('Suelta 1');
  });

  it('Mover lleva la nota a 21.11 Hebra; Archivar mueve la siguiente a .09 y la quita de la cola', async () => {
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);

    void findCommand(fake, JDEX_COMMAND_PROCESS_INBOX).run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    const move = [...dialog.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Mover…'
    ) as HTMLButtonElement;
    move.click();
    const option = [...dialog.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('21.11 Hebra')
    ) as HTMLButtonElement;
    option.click();
    await vi.waitFor(() => expect(dialog.textContent).toContain('Suelta 2'));
    const moved = await fixture.library.noteRead('n-inbox-1');
    expect(moved?.folderId).toBe(fixture.ids.hebraId.id);

    const archive = [...dialog.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent?.startsWith('Archivar en')
    ) as HTMLButtonElement;
    archive.click();
    await vi.waitFor(() => expect(dialog.textContent).toContain('Bandeja de entrada procesada'));
    const archived = await fixture.library.noteRead('n-inbox-2');
    expect(archived?.body).not.toContain('tipo:');
    expect(archived?.folderId).toBe(fixture.ids.archiveId.id);
    void findCommand(fake, JDEX_COMMAND_PROCESS_INBOX).run();
    expect(document.body.textContent).toContain('La bandeja de entrada está vacía');
  });

  it('Omitir y Abrir avanzan sin escribir; Abrir llama a openNoteById', async () => {
    const fixture = buildFixture();
    const { api, fake, workspace } = await setup(fixture);
    await activateJdex(api);

    void findCommand(fake, JDEX_COMMAND_PROCESS_INBOX).run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    const skip = [...dialog.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Omitir'
    ) as HTMLButtonElement;
    skip.click();
    expect(dialog.textContent).toContain('Suelta 2');

    const open = [...dialog.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Abrir'
    ) as HTMLButtonElement;
    open.click();
    expect(workspace.openNote).toHaveBeenCalledWith('n-inbox-2');
    expect(dialog.textContent).toContain('Bandeja de entrada procesada');

    const unchanged1 = await fixture.library.noteRead('n-inbox-1');
    const unchanged2 = await fixture.library.noteRead('n-inbox-2');
    expect(unchanged1?.folderId).toBe(fixture.ids.catInbox.id);
    expect(unchanged2?.body).not.toContain('archivado');
  });
});

describe('activate — lote 4, sección del ID en el panel de contexto', () => {
  it('registra la vista de columna', async () => {
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);
    const view = fake.recorded.views.find((v) => v.id === JDEX_ID_SECTION_VIEW_ID)!;
    expect(view).toBeTruthy();
    expect(view.placement).toBe('column');
  });

  it('con la nota JDex de 21.11 activa: ruta, descripción y ficheros de la carpeta', async () => {
    const fixture = buildFixture();
    const { api, fake, workspace } = await setup(fixture);
    await activateJdex(api);
    workspace.setActiveNote({ id: 'n-hebra', folderId: fixture.ids.jdexId.id, title: '21.11 Hebra' });

    const view = fake.recorded.views.find((v) => v.id === JDEX_ID_SECTION_VIEW_ID)!;
    const el = document.createElement('div');
    view.mount(el);
    await vi.waitFor(() => expect(el.textContent).toContain('21.11 Hebra'));
    expect(el.textContent).toContain('Notas Markdown local-first.');
  });

  it('nota fuera del sistema JDex: aviso', async () => {
    const fixture = buildFixture();
    const { api, fake, workspace } = await setup(fixture);
    await activateJdex(api);
    workspace.setActiveNote({ id: 'n-otra', folderId: ROOT_FOLDER_ID, title: 'Nota suelta' });

    const view = fake.recorded.views.find((v) => v.id === JDEX_ID_SECTION_VIEW_ID)!;
    const el = document.createElement('div');
    view.mount(el);
    await vi.waitFor(() => expect(el.textContent).toContain('no vive en ningún ID'));
  });
});
