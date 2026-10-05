// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JDEX_AUDIT_VIEW_ID, activateJdex } from '../../src/hebra/jdex-runtime';
import { FakeJdexVault, createJdexTestApi, fakeFolder, fakeNote } from './support/fakes';

/** Un sistema real del adaptador con una única nota sin descripción. */
async function setup() {
  const library = new FakeJdexVault();
  for (const folder of [
    fakeFolder('system-area', null, '00-09 Sistema'),
    fakeFolder('system-cat', 'system-area', '00 Sistema'),
    fakeFolder('jdex', 'system-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id', 'cat', '21.11 Hebra'),
  ]) library.seedFolder(folder);
  library.seedNote(fakeNote('n1', 'jdex', [
    '---', 'jd: "21.11"', 'tipo: id', 'area: 20-29 Productos', 'categoria: 21 Software',
    '---', '# 21.11 Hebra', '', 'Notas Markdown locales. Segunda frase.', '',
  ].join('\n')));
  const { api, fake } = await createJdexTestApi({ vault: library });
  const deactivate = await activateJdex(api);
  const el = document.createElement('div');
  document.body.append(el);
  fake.recorded.views.find((view) => view.id === JDEX_AUDIT_VIEW_ID)!.mount(el);
  const row = [...el.querySelectorAll('li')].find((entry) => entry.textContent?.includes('sin descripción'))!;
  const apply = row.querySelector<HTMLButtonElement>('.hebra-jdex-audit-apply')!;
  expect(apply).toBeTruthy();
  return { library, el, apply, deactivate };
}

afterEach(() => document.body.replaceChildren());

describe('Hebra — Aplicar desde la auditoría', () => {
  it('escribe descripcion y actualiza la vista sin el hallazgo', async () => {
    const { library, el, apply, deactivate } = await setup();
    apply.click();
    await vi.waitFor(async () => expect((await library.noteRead('n1'))?.body).toContain('descripcion: "Notas Markdown locales."'));
    await vi.waitFor(() => expect(el.textContent).not.toContain('sin descripción'));
    await deactivate();
  });

  it('avisa del bloqueo y mantiene el hallazgo', async () => {
    const { library, el, apply, deactivate } = await setup();
    library.setLocked('n1', true);
    apply.click();
    await vi.waitFor(() => expect(document.querySelector('.hebra-module-notice')?.textContent).toContain('la nota está bloqueada'));
    expect(library.rewriteCalls).toHaveLength(0);
    expect(el.textContent).toContain('sin descripción');
    await deactivate();
  });

  it('avisa si la descripción cambió después de abrir la auditoría y conserva la edición', async () => {
    const { library, el, apply, deactivate } = await setup();
    const before = (await library.noteRead('n1'))!.body!;
    library.saveElsewhere('n1', before.replace('tipo: id', 'tipo: id\ndescripcion: Manual posterior.'));
    apply.click();
    await vi.waitFor(() => expect(document.querySelector('.hebra-module-notice')?.textContent).toContain('descripcion porque cambió desde la auditoría'));
    expect((await library.noteRead('n1'))?.body).toContain('descripcion: Manual posterior.');
    expect(library.rewriteCalls).toHaveLength(0);
    await vi.waitFor(() => expect(el.textContent).not.toContain('sin descripción'));
    await deactivate();
  });

  it('avisa de una revisión obsoleta después de dos intentos y mantiene el hallazgo', async () => {
    const { library, el, apply, deactivate } = await setup();
    const write = vi.spyOn(library, 'notesRewriteBatch').mockResolvedValue({ written: [], stale: ['n1'] });
    apply.click();
    await vi.waitFor(() => expect(document.querySelector('.hebra-module-notice')?.textContent).toContain('cambió durante los dos intentos'));
    expect(write).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('sin descripción');
    expect((await library.noteRead('n1'))?.body).not.toContain('descripcion:');
    await deactivate();
  });
});
