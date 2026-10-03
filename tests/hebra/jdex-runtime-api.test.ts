// @vitest-environment happy-dom
//
// Lo que `activateJdex` hace SOLO porque ahora habla con `HebraPluginApi` (en Hebra lo hacía
// `LibraryApp.svelte` por su cuenta y no se probaba aquí): la consulta de búsqueda que se
// pasa a `workspace.openSearch`, la guardia de renombrado de `workspace`, la extensión del
// editor (`editor.registerExtension`, que puede rechazarse), los ajustes por
// `storage.settings`, el selector de carpeta de `ui.pickFolder`, el ajuste de fechas ISO de
// `env` y la entrada `activate` de `main.ts`.
import type { PluginFolder } from 'hebra-plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activate } from '../../src/hebra/main';
import {
  JDEX_COMMAND_GOTO_ID,
  JDEX_ID_SECTION_VIEW_ID,
  activateJdex
} from '../../src/hebra/jdex-runtime';
import { FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

const HEBRA_PATH =
  '20-29 Productos y servicios/21 Productos de software propios/21.11 Hebra';
const NOON = new Date(2026, 9, 3, 12, 0).getTime();

/** `00-09 Sistema/00 Sistema/00.00 JDex` con la nota de `21.11 Hebra` y la carpeta del ID
 *  con una nota de contenido de fecha conocida. */
function buildFixture() {
  const vault = new FakeJdexVault();
  const folders: PluginFolder[] = [
    fakeFolder('f-sis', null, '00-09 Sistema'),
    fakeFolder('f-sis-cat', 'f-sis', '00 Sistema'),
    fakeFolder('f-jdex', 'f-sis-cat', '00.00 JDex'),
    fakeFolder('f-prod', null, '20-29 Productos y servicios'),
    fakeFolder('f-cat', 'f-prod', '21 Productos de software propios'),
    fakeFolder('f-hebra', 'f-cat', '21.11 Hebra')
  ];
  for (const folder of folders) vault.seedFolder(folder);
  vault.seedNote(
    fakeNote(
      'n-hebra',
      'f-jdex',
      ['---', 'jd: 21.11', 'tipo: id', 'descripcion: Notas locales.', '---', '# 21.11 Hebra', ''].join(
        '\n'
      )
    )
  );
  vault.seedNote(fakeNote('n-content', 'f-hebra', '# Notas de Hebra\n', { updatedAt: NOON }));
  return { vault, folders };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function click(el: Element | null | undefined): void {
  (el as HTMLElement).click();
}

describe('búsqueda dentro de un ID', () => {
  it('«Buscar dentro de este ID» abre la búsqueda de Hebra con path:"<carpeta>"', async () => {
    const { vault } = buildFixture();
    const { api, fake, workspace } = await createJdexTestApi({ vault });
    await activateJdex(api);

    void fake.recorded.commands.find((c) => c.id === JDEX_COMMAND_GOTO_ID)!.run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    click([...dialog.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('21.11 Hebra')));
    click(
      [...dialog.querySelectorAll('.hebra-jdex-goto-action')].find(
        (b) => b.textContent === 'Buscar dentro de este ID'
      )
    );
    expect(workspace.openSearch).toHaveBeenCalledWith(`path:"${HEBRA_PATH}"`);
  });
});

describe('guardia de renombrado (workspace.onBeforeFolderRename)', () => {
  it('se registra al activar y se retira al apagar', async () => {
    const { vault } = buildFixture();
    const { api, workspace } = await createJdexTestApi({ vault });
    const cleanup = await activateJdex(api);
    expect(workspace.guardCount).toBe(1);
    await cleanup();
    expect(workspace.guardCount).toBe(0);
  });

  it('renumerar un ID pregunta; «Continuar» deja pasar y «Cancelar» lo impide', async () => {
    const { vault } = buildFixture();
    const { api, workspace } = await createJdexTestApi({ vault });
    await activateJdex(api);

    const continued = workspace.askFolderRename({
      kind: 'folder-rename',
      folderId: 'f-hebra',
      newName: '21.12 Hebra'
    });
    await vi.waitFor(() => expect(document.querySelector('dialog.hebra-module-modal')).toBeTruthy());
    expect(document.body.textContent).toContain('«21.11» pasaría a «21.12»');
    click(document.querySelector('dialog .hebra-jdex-dialog-primary'));
    expect(await continued).toBe(true);
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();

    const cancelled = workspace.askFolderRename({
      kind: 'folder-rename',
      folderId: 'f-hebra',
      newName: '21.12 Hebra'
    });
    await vi.waitFor(() => expect(document.querySelector('dialog.hebra-module-modal')).toBeTruthy());
    click(
      [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Cancelar')
    );
    expect(await cancelled).toBe(false);
  });

  it('un renombrado que no cambia el número del ID (o una carpeta ajena) pasa sin preguntar', async () => {
    const { vault } = buildFixture();
    const { api, workspace } = await createJdexTestApi({ vault });
    await activateJdex(api);

    expect(
      await workspace.askFolderRename({
        kind: 'folder-rename',
        folderId: 'f-hebra',
        newName: '21.11 Otro nombre'
      })
    ).toBe(true);
    expect(
      await workspace.askFolderRename({
        kind: 'folder-move',
        folderId: 'carpeta-que-no-existe',
        newParentId: null
      })
    ).toBe(true);
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
  });
});

describe('extensión del editor (editor.registerExtension)', () => {
  it('con la capacidad «editor» declarada, se registra una extensión', async () => {
    const { vault } = buildFixture();
    const { api, fake } = await createJdexTestApi({ vault });
    await activateJdex(api);
    expect(fake.recorded.extensions).toHaveLength(1);
  });

  it('si Hebra la rechaza, el plugin sigue activo, sin números clicables', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { vault } = buildFixture();
    // Sin «editor» declarado, el host falso rechaza igual que `extension-rechazada`.
    const { api, fake } = await createJdexTestApi({ vault, capabilities: ['vault.read', 'vault.write'] });
    const cleanup = await activateJdex(api);
    expect(fake.recorded.extensions).toHaveLength(0);
    expect(fake.recorded.commands.length).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalledWith('[jdex] extension-del-editor', expect.anything());
    await cleanup();
  });
});

describe('ajustes (storage.settings)', () => {
  it('la autodetección persiste lo que encuentra, en las claves de siempre', async () => {
    const { vault } = buildFixture();
    const { api } = await createJdexTestApi({ vault });
    await activateJdex(api);
    expect(await api.storage.settings.load()).toEqual({
      jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex',
      systemRoot: '',
      templatesFolder: '',
      reportsFolder: '',
      systemId: ''
    });
  });

  it('un valor ya guardado se respeta y el panel guarda el cambio por la API', async () => {
    const { vault } = buildFixture();
    const { api, fake } = await createJdexTestApi({
      vault,
      settings: { jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex', systemRoot: '' }
    });
    await activateJdex(api);

    const el = document.createElement('div');
    fake.recorded.settingsPanels[0](el);
    const systemId = [...el.querySelectorAll('input')].find((i) => i.placeholder.startsWith('D01'))!;
    systemId.value = 'D01';
    systemId.dispatchEvent(new Event('change'));
    await vi.waitFor(async () =>
      expect(await api.storage.settings.load()).toMatchObject({
        jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex',
        systemId: 'D01'
      })
    );
  });

  it('«Elegir carpeta…» resuelve el id que da ui.pickFolder a la ruta completa', async () => {
    const { vault } = buildFixture();
    const { api, fake } = await createJdexTestApi({ vault });
    (api.ui as { pickFolder: () => Promise<string | null> }).pickFolder = async () => 'f-hebra';
    await activateJdex(api);

    const el = document.createElement('div');
    fake.recorded.settingsPanels[0](el);
    const pick = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Elegir carpeta…')!;
    click(pick);
    await vi.waitFor(async () =>
      expect(await api.storage.settings.load()).toMatchObject({ systemRoot: HEBRA_PATH })
    );
  });

  it('cancelar el selector (null) no cambia nada', async () => {
    const { vault } = buildFixture();
    const { api, fake } = await createJdexTestApi({
      vault,
      settings: { systemRoot: 'Sistema' }
    });
    await activateJdex(api);
    const el = document.createElement('div');
    fake.recorded.settingsPanels[0](el);
    const before = await api.storage.settings.load();
    click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Elegir carpeta…'));
    await Promise.resolve();
    expect(await api.storage.settings.load()).toEqual(before);
  });
});

describe('fechas de la sección del ID (env.isoDates)', () => {
  it('se repintan solas al cambiar el ajuste «Usar fechas ISO 8601» de Hebra', async () => {
    const { vault } = buildFixture();
    const { api, fake, workspace } = await createJdexTestApi({ vault });
    await activateJdex(api);
    workspace.setActiveNote({ id: 'n-hebra', folderId: 'f-jdex', title: '21.11 Hebra' });

    const view = fake.recorded.views.find((v) => v.id === JDEX_ID_SECTION_VIEW_ID)!;
    const el = document.createElement('div');
    view.mount(el);
    const date = () => el.querySelector('.hebra-jdex-section-row small')?.textContent;
    await vi.waitFor(() => expect(date()).toBe('03/10/2026'));

    fake.setIsoDates(true);
    await vi.waitFor(() => expect(date()).toBe('2026-10-03'));
    fake.setIsoDates(false);
    await vi.waitFor(() => expect(date()).toBe('03/10/2026'));
  });
});

describe('main.ts', () => {
  it('activate(api) activa el plugin y devuelve la limpieza que lo deshace todo', async () => {
    const { vault } = buildFixture();
    const { api, fake, workspace } = await createJdexTestApi({ vault });
    const cleanup = await activate(api);
    expect(typeof cleanup).toBe('function');
    expect(fake.recorded.commands.length).toBeGreaterThanOrEqual(15);
    expect(fake.recorded.views).toHaveLength(2);
    expect(fake.recorded.settingsPanels).toHaveLength(1);
    expect(fake.recorded.extensions).toHaveLength(1);
    expect(fake.recorded.statusBarItems.map((item) => item.id).sort()).toEqual([
      'jdex-audit',
      'jdex-inbox'
    ]);

    await cleanup();
    expect(fake.recorded.commands).toHaveLength(0);
    expect(fake.recorded.views).toHaveLength(0);
    expect(fake.recorded.settingsPanels).toHaveLength(0);
    expect(fake.recorded.extensions).toHaveLength(0);
    expect(fake.recorded.statusBarItems).toHaveLength(0);
    expect(workspace.guardCount).toBe(0);
  });
});
