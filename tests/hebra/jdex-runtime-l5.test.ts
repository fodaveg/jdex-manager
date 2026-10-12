// @vitest-environment happy-dom
//
// Lot L5 of the 12 Oct 2026 audit, through `activateJdex` and the fake host: creating in
// prefixed systems (D01, D02) from the Create ID dialog.
import type { PluginFolder } from 'hebra-plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JDEX_COMMAND_CREATE_CHILD, JDEX_COMMAND_CREATE_ID, activateJdex } from '../../src/hebra/jdex-runtime';
import * as guard from '../../src/hebra/jdex-rename-guard';
import { FOLDER_RENAME_GUARD_TIMEOUT_MS, FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

// The real check, wrapped so one test can make it throw.
vi.mock('../../src/hebra/jdex-rename-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hebra/jdex-rename-guard')>();
  return { ...actual, jdexRenameWarning: vi.fn(actual.jdexRenameWarning) };
});

function click(el: Element | null | undefined): void {
  (el as HTMLElement).click();
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A library whose categories are ALL prefixed: `D01.21` and `D02.21`, same number,
 *  separate identities. The JDex lives in a plain `JDex` folder. */
function prefixedOnlyFixture() {
  const vault = new FakeJdexVault();
  const folders: PluginFolder[] = [
    fakeFolder('f-jdex', null, 'JDex'),
    fakeFolder('f-d01-area', null, 'D01.20-29 Trabajo'),
    fakeFolder('f-d01-cat', 'f-d01-area', 'D01.21 Productos'),
    fakeFolder('f-d02-area', null, 'D02.20-29 Casa'),
    fakeFolder('f-d02-cat', 'f-d02-area', 'D02.21 Hogar')
  ];
  for (const folder of folders) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-d01-cat', 'f-jdex', '# D01.21 Productos\n'));
  vault.seedNote(fakeNote('n-d02-cat', 'f-jdex', '# D02.21 Hogar\n'));
  return vault;
}

async function notesIn(vault: FakeJdexVault, folderId: string): Promise<string[]> {
  const page = await vault.notesPage(null, 100, { kind: 'folder', folderId });
  return page.items.map((item) => item.title).sort();
}

describe('crear en sistemas con prefijo (27d68243)', () => {
  it('con todas las categorías en D01 o D02 y sin prefijo configurado, crea un ID en cada una y hereda su sistema', async () => {
    const vault = prefixedOnlyFixture();
    const { api, fake } = await createJdexTestApi({ vault, settings: { jdexFolder: 'JDex', systemRoot: '' } });
    await activateJdex(api);

    for (const [categoryLabel, title, expected] of [
      ['D01.21 Productos', 'Uno', 'D01.21.11 Uno'],
      ['D02.21 Hogar', 'Dos', 'D02.21.11 Dos']
    ] as const) {
      void fake.recorded.commands.find((c) => c.id === JDEX_COMMAND_CREATE_ID)!.run();
      const dialog = document.querySelector('dialog.hebra-module-modal')!;
      const select = dialog.querySelector('select')!;
      const labels = [...select.options].map((o) => o.textContent);
      expect(labels).toEqual(expect.arrayContaining(['D01.21 Productos', 'D02.21 Hogar']));
      select.value = [...select.options].find((o) => o.textContent === categoryLabel)!.value;
      select.dispatchEvent(new Event('change'));
      const [idInput, titleInput] = [...dialog.querySelectorAll<HTMLInputElement>('input[type="text"]')];
      // Each system numbers on its own: D01.21.11 does not occupy D02.21.11.
      expect(idInput.value).toBe('21.11');
      titleInput.value = title;
      titleInput.dispatchEvent(new Event('input'));
      (dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(document.querySelector('dialog.hebra-module-modal')).toBeNull());
      expect(await notesIn(vault, 'f-jdex')).toContain(expected);
    }
  });
});

/** An unprefixed ID and a D01 one, both with note and folder. */
function renameFixture() {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('f-jdex', null, 'JDex'),
    fakeFolder('f-area', null, '20-29 Productos'),
    fakeFolder('f-cat', 'f-area', '21 Software'),
    fakeFolder('f-id', 'f-cat', '21.11 Hebra'),
    fakeFolder('f-cat22', 'f-area', '22 Otros'),
    fakeFolder('f-d01-area', null, 'D01.20-29 Trabajo'),
    fakeFolder('f-d01-cat', 'f-d01-area', 'D01.21 Productos'),
    fakeFolder('f-d01-id', 'f-d01-cat', 'D01.21.11 Uno')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-id', 'f-jdex', '# 21.11 Hebra\n'));
  vault.seedNote(fakeNote('n-d01', 'f-jdex', '# D01.21.11 Uno\n'));
  return vault;
}

async function folderName(vault: FakeJdexVault, id: string): Promise<string | undefined> {
  return (await vault.foldersList()).find((folder) => folder.id === id)?.name;
}

const RENUMBER = { kind: 'folder-rename', folderId: 'f-id', newName: '21.12 Hebra' } as const;

describe('guardia de renombrado frente al host (a17a3b63)', () => {
  async function setup() {
    const vault = renameFixture();
    const test = await createJdexTestApi({ vault, settings: { jdexFolder: 'JDex', systemRoot: '' } });
    await activateJdex(test.api);
    return { ...test, vault };
  }

  it('pasados los 5 s del host sin respuesta, el ID conserva su número', async () => {
    const { vault, workspace } = await setup();
    vi.useFakeTimers();
    try {
      const result = workspace.changeFolderAsHost(vault, RENUMBER);
      await vi.advanceTimersByTimeAsync(FOLDER_RENAME_GUARD_TIMEOUT_MS + 1);
      expect(await result).toBe(false);
      expect(workspace.guardFaults).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
    expect(await folderName(vault, 'f-id')).toBe('21.11 Hebra');
    // The question is still there; nothing happened without an answer.
    expect(document.body.textContent).toContain('«21.11» pasaría a «21.12»');
  });

  it('«Cancelar» y Escape (cierre del diálogo) dejan el ID como estaba', async () => {
    const { vault, workspace } = await setup();
    expect(await workspace.changeFolderAsHost(vault, RENUMBER)).toBe(false);
    click([...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Cancelar'));
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();

    expect(await workspace.changeFolderAsHost(vault, RENUMBER)).toBe(false);
    document.querySelector('dialog.hebra-module-modal')!.dispatchEvent(new Event('cancel'));
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await folderName(vault, 'f-id')).toBe('21.11 Hebra');
  });

  it('si la comprobación falla, no deja pasar el cambio (nunca falla abierta)', async () => {
    const { vault, workspace, fake } = await setup();
    vi.mocked(guard.jdexRenameWarning).mockImplementationOnce(() => {
      throw new Error('índice corrupto');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await workspace.changeFolderAsHost(vault, RENUMBER)).toBe(false);
    expect(await folderName(vault, 'f-id')).toBe('21.11 Hebra');
    expect(fake.recorded.notices.at(-1)).toContain('no lo ha hecho');
  });

  it('solo «Renombrar igualmente» hace el cambio, y solo si la carpeta no cambió desde el aviso', async () => {
    const { vault, workspace, fake } = await setup();
    expect(await workspace.changeFolderAsHost(vault, RENUMBER)).toBe(false);
    const confirm = document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!;
    expect(confirm.textContent).toBe('Renombrar igualmente');
    confirm.click();
    await vi.waitFor(async () => expect(await folderName(vault, 'f-id')).toBe('21.12 Hebra'));

    // Asked, then the folder changed elsewhere: the confirmation does not apply to it.
    expect(await workspace.changeFolderAsHost(vault, { kind: 'folder-rename', folderId: 'f-id', newName: '21.13 Hebra' })).toBe(false);
    await vault.folderRename('f-id', '21.12 Hebra renombrada en otro dispositivo');
    document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!.click();
    await vi.waitFor(() => expect(fake.recorded.notices).toContain('La carpeta cambió desde el aviso; no se ha tocado.'));
    expect(await folderName(vault, 'f-id')).toBe('21.12 Hebra renombrada en otro dispositivo');
  });

  it('mover un ID a otra categoría también se para y se rehace solo al confirmar', async () => {
    const { vault, workspace } = await setup();
    const move = { kind: 'folder-move', folderId: 'f-id', newParentId: 'f-cat22' } as const;
    expect(await workspace.changeFolderAsHost(vault, move)).toBe(false);
    expect((await vault.foldersList()).find((f) => f.id === 'f-id')?.parentId).toBe('f-cat');
    const confirm = document.querySelector<HTMLButtonElement>('dialog .hebra-jdex-dialog-primary')!;
    expect(confirm.textContent).toBe('Mover igualmente');
    confirm.click();
    await vi.waitFor(async () => expect((await vault.foldersList()).find((f) => f.id === 'f-id')?.parentId).toBe('f-cat22'));
  });

  it('D01 y D02 son identidades separadas: pasar D01.21.11 a D02.21.11 se trata como renumerar', async () => {
    const { vault, workspace } = await setup();
    const event = { kind: 'folder-rename', folderId: 'f-d01-id', newName: 'D02.21.11 Uno' } as const;
    expect(await workspace.changeFolderAsHost(vault, event)).toBe(false);
    expect(document.body.textContent).toContain('«D01.21.11» pasaría a «D02.21.11»');
    document.querySelector('dialog.hebra-module-modal')!.dispatchEvent(new Event('cancel'));
    expect(await folderName(vault, 'f-d01-id')).toBe('D01.21.11 Uno');
  });

  it('un renombrado que no toca el número pasa sin preguntar', async () => {
    const { vault, workspace } = await setup();
    expect(await workspace.changeFolderAsHost(vault, { kind: 'folder-rename', folderId: 'f-id', newName: '21.11 Hebra app' })).toBe(true);
    expect(await folderName(vault, 'f-id')).toBe('21.11 Hebra app');
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
  });
});

describe('el doble de la guardia imita al host (a17a3b63)', () => {
  it('una guardia que no responde cuenta como «sí» pasados FOLDER_RENAME_GUARD_TIMEOUT_MS, y una que lanza también', async () => {
    const vault = renameFixture();
    const { api, workspace } = await createJdexTestApi({ vault });
    api.workspace.onBeforeFolderRename(() => new Promise<boolean>(() => {}));
    vi.useFakeTimers();
    try {
      const result = workspace.askFolderRename(RENUMBER);
      await vi.advanceTimersByTimeAsync(FOLDER_RENAME_GUARD_TIMEOUT_MS - 1);
      let settled = false;
      void result.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await result).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(workspace.guardFaults).toHaveLength(1);

    const { api: api2, workspace: workspace2 } = await createJdexTestApi({ vault });
    api2.workspace.onBeforeFolderRename(() => Promise.reject(new Error('boom')));
    expect(await workspace2.askFolderRename(RENUMBER)).toBe(true);
    expect(workspace2.guardFaults).toHaveLength(1);
  });
});

describe('no crear hijos de hijos (26dfbba6)', () => {
  it('con la nota de un hijo 21.11+ abierta, «crear hijo» avisa y no abre el diálogo', async () => {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('f-jdex', null, 'JDex'),
      fakeFolder('f-area', null, '20-29 Productos'),
      fakeFolder('f-cat', 'f-area', '21 Software'),
      fakeFolder('f-id', 'f-cat', '21.11 Hebra')
    ]) vault.seedFolder(folder);
    vault.seedNote(fakeNote('n-id', 'f-jdex', '# 21.11 Hebra\n'));
    vault.seedNote(fakeNote('n-child', 'f-jdex', '# 21.11+ Extensión\n'));
    const { api, fake, workspace } = await createJdexTestApi({ vault, settings: { jdexFolder: 'JDex', systemRoot: '' } });
    await activateJdex(api);

    workspace.setActiveNote({ id: 'n-child', folderId: 'f-jdex', title: '21.11+ Extensión' });
    void fake.recorded.commands.find((c) => c.id === JDEX_COMMAND_CREATE_CHILD)!.run();
    expect(fake.recorded.notices).toContain('Un hijo (+) no puede tener hijos: créalo desde su ID padre.');
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();

    // The real parent still offers the dialog.
    workspace.setActiveNote({ id: 'n-id', folderId: 'f-jdex', title: '21.11 Hebra' });
    void fake.recorded.commands.find((c) => c.id === JDEX_COMMAND_CREATE_CHILD)!.run();
    expect(document.querySelector('dialog.hebra-module-modal')?.textContent).toContain('Hijo de 21.11 Hebra (21.11+)');
  });
});
