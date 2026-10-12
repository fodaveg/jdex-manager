// @vitest-environment happy-dom
//
// Lot L5 of the 12 Oct 2026 audit, through `activateJdex` and the fake host: creating in
// prefixed systems (D01, D02) from the Create ID dialog.
import type { PluginFolder } from 'hebra-plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JDEX_COMMAND_CREATE_ID, activateJdex } from '../../src/hebra/jdex-runtime';
import { FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

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
