// @vitest-environment happy-dom
//
// El lote 2 (crear ID/categoría/área/cabecera/hijo, normalizar el frontmatter,
// cabeceras e índice al día) de extremo a extremo: `activateJdex(api)` sobre el host falso
// del paquete (comandos y piezas registrados), diálogo montado de verdad en el DOM
// (`support/fakes.ts`) y biblioteca en memoria (`FakeJdexVault`, con lectura Y escritura).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginFolder } from 'hebra-plugin-api';
import {
  JDEX_COMMAND_CREATE_AREA,
  JDEX_COMMAND_CREATE_CATEGORY,
  JDEX_COMMAND_CREATE_CHILD,
  JDEX_COMMAND_CREATE_HEADER,
  JDEX_COMMAND_CREATE_ID,
  JDEX_COMMAND_NORMALIZE_ALL,
  JDEX_COMMAND_NORMALIZE_NOTE,
  JDEX_COMMAND_REFRESH_HEADERS,
  JDEX_COMMAND_REFRESH_INDEX,
  JDEX_COMMAND_WRAP_HEADERS,
  JDEX_STATUS_AUDIT_ID,
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

/** `00-09/00/00.00 JDex` con la nota de `21.11 Hebra` (frontmatter correcto salvo por
 *  probar «normalizar») y `21 Productos de software` bajo `20-29`, con `21.11 Hebra`
 *  como única categoría/ID de contenido. */
function buildFixture() {
  const sistemaArea = folder('00-09 Sistema', ROOT_FOLDER_ID);
  const sistemaCat = folder('00 Sistema', sistemaArea.id);
  const jdexId = folder('00.00 JDex', sistemaCat.id);
  const productosArea = folder('20-29 Productos y servicios', ROOT_FOLDER_ID);
  const productosCat = folder('21 Productos de software propios', productosArea.id);
  const hebraId = folder('21.11 Hebra', productosCat.id);

  const folders: PluginFolder[] = [
    sistemaArea,
    sistemaCat,
    jdexId,
    productosArea,
    productosCat,
    hebraId
  ];

  const library = new FakeJdexVault();
  library.seedFolder(fakeFolder(sistemaArea.id, null, sistemaArea.name));
  library.seedFolder(fakeFolder(sistemaCat.id, sistemaArea.id, sistemaCat.name));
  library.seedFolder(fakeFolder(jdexId.id, sistemaCat.id, jdexId.name));
  library.seedFolder(fakeFolder(productosArea.id, null, productosArea.name));
  library.seedFolder(fakeFolder(productosCat.id, productosArea.id, productosCat.name));
  library.seedFolder(fakeFolder(hebraId.id, productosCat.id, hebraId.name));

  // `jd: 21.11` SIN comillas (número 21.11 real de YAML): el hallazgo que «normalizar»
  // debe arreglar.
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

  return { folders, library, ids: { jdexId, productosCat, hebraId } };
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

describe('activate — lote 2', () => {
  it('registra los diez comandos nuevos', async () => {
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);
    const ids = fake.recorded.commands.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        JDEX_COMMAND_CREATE_ID,
        JDEX_COMMAND_CREATE_CATEGORY,
        JDEX_COMMAND_CREATE_AREA,
        JDEX_COMMAND_CREATE_HEADER,
        JDEX_COMMAND_CREATE_CHILD,
        JDEX_COMMAND_NORMALIZE_NOTE,
        JDEX_COMMAND_NORMALIZE_ALL,
        JDEX_COMMAND_REFRESH_HEADERS,
        JDEX_COMMAND_REFRESH_INDEX,
        JDEX_COMMAND_WRAP_HEADERS
      ])
    );
  });

  it('«JDex: crear ID» crea la nota, la abre y baja el recuento de hallazgos', async () => {
    const fixture = buildFixture();
    const { api, fake, workspace } = await setup(fixture);
    await activateJdex(api);

    const before = fake.recorded.statusBarItems.find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    const beforeCount = Number(/^JD: (\d+)$/.exec(before.text)![1]);

    void findCommand(fake, JDEX_COMMAND_CREATE_ID).run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    expect(dialog).toBeTruthy();
    // Dos categorías en este sistema (00 y 21): el `<select>` propone la primera por
    // orden (00), así que hay que elegir 21 antes de teclear el número.
    const select = dialog.querySelector('select') as HTMLSelectElement;
    select.value = '21';
    select.dispatchEvent(new Event('change'));
    const [numberInput, titleInput] = [
      ...dialog.querySelectorAll('input[type="text"]')
    ] as HTMLInputElement[];
    numberInput.value = '21.31';
    numberInput.dispatchEvent(new Event('input'));
    titleInput.value = 'Módulo nuevo';
    titleInput.dispatchEvent(new Event('input'));
    const submit = dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    submit.click();
    await vi.waitFor(() => expect(workspace.openNote).toHaveBeenCalled());

    // El diálogo se cerró y la nota nueva existe con el frontmatter esperado.
    expect(document.body.querySelector('dialog.hebra-module-modal')).toBeNull();
    const createdId = (workspace.openNote as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const created = await fixture.library.noteRead(createdId);
    expect(created?.title).toBe('21.31 Módulo nuevo');
    expect(created?.body).toContain('jd: "21.31"');
    expect(created?.body).toContain('categoria: "21 Productos de software propios"');

    // El recuento de hallazgos se recalculó solo (task 4, «recalcula tú»): sin la
    // reconstrucción tras escribir, la barra seguiría mostrando el número de ANTES.
    const after = fake.recorded.statusBarItems.find((item) => item.id === JDEX_STATUS_AUDIT_ID)!;
    const afterCount = Number(/^JD: (\d+)$/.exec(after.text)![1]);
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it('«JDex: normalizar el frontmatter de toda la JDex» fusiona area/categoria que faltaban', async () => {
    // `jd: 21.11` sin comillas parsea a 21.11 y `String(21.11)` ya coincide con «21.11»
    // (el caso de ambigüedad real es `.X0`, ya probado en `jdex-normalize.test.ts` con
    // `21.20`): aquí lo que falta de verdad es `area`/`categoria`, que la nota nunca
    // llevó.
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);

    void findCommand(fake, JDEX_COMMAND_NORMALIZE_ALL).run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    const apply = dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    expect(apply).toBeTruthy();
    apply.click();
    await vi.waitFor(async () => {
      const note = await fixture.library.noteRead('n-hebra');
      expect(note?.body).toContain('area: "20-29 Productos y servicios"');
      expect(note?.body).toContain('categoria: "21 Productos de software propios"');
      // Lo que ya estaba, intacto.
      expect(note?.body).toContain('descripcion: Notas Markdown local-first.');
    });
  });

  it('«JDex: crear ID hijo (+)» exige una nota JDex activa', async () => {
    const fixture = buildFixture();
    const { api, fake } = await setup(fixture);
    await activateJdex(api);
    void findCommand(fake, JDEX_COMMAND_CREATE_CHILD).run();
    expect(document.body.querySelector('dialog.hebra-module-modal')).toBeNull();
  });
});
