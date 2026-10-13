import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import type { IdEntry } from '../../src/hebra/engine';
import { jdexCompletionProvider, jdexDecorationProvider, registerJdexEditor } from '../../src/hebra/jdex-editor-extension';

function entry(overrides: Partial<IdEntry> = {}): IdEntry {
  return {
    id: '21.11', category: '21', title: 'Hebra', label: '21.11 Hebra',
    folderPath: '20-29/21/21.11 Hebra', notePath: '00.00 JDex/21.11 Hebra.md',
    ...overrides
  };
}

describe('editor declarativo de JDex (host falso publicado de API 2.0)', () => {
  it('decora solo los IDs existentes dentro del recorte, con posiciones del cuerpo completo', async () => {
    const fake = createFakePluginApiV2({ capabilities: ['editor'] });
    const off = registerJdexEditor(fake.api.editor, { ids: () => [entry()], onNavigate: vi.fn() });
    await fake.settle();
    expect(fake.editor.providers()).toEqual({ decorations: ['jdex-numbers'], completions: ['jdex-ids'] });
    expect(await fake.editor.decorate({ text: 'Ver 21.11 y 99.99', offset: 100, length: 500 })).toEqual([
      { from: 104, to: 109, style: 'link', clickable: true, data: '21.11' }
    ]);
    expect(await fake.editor.decorate({ text: 'Ver `21.11` y [[21.11 Hebra]]' })).toEqual([]);
    expect(await fake.editor.decorate({ text: '21.11', protectedNote: true })).toEqual([]);
    off();
    await fake.settle();
    expect(fake.editor.providers()).toEqual({ decorations: [], completions: [] });
    await fake.dispose();
  });

  it('usa el índice vivo y exige modificadora primaria para navegar; Alt elige carpeta', () => {
    let ids: IdEntry[] = [];
    const onNavigate = vi.fn();
    const provider = jdexDecorationProvider({ ids: () => ids, onNavigate });
    expect(provider.provide({ noteId: 'n', text: '21.11', offset: 0, length: 5 })).toEqual([]);
    ids = [entry()];
    expect(provider.provide({ noteId: 'n', text: '21.11', offset: 0, length: 5 })).toHaveLength(1);
    const click = (ctrl: boolean, alt: boolean) => provider.onClick?.({
      noteId: 'n', from: 0, to: 5, data: '21.11',
      pointer: { x: 0, y: 0, button: 0, alt, ctrl, meta: false, shift: false }
    });
    click(false, false);
    expect(onNavigate).not.toHaveBeenCalled();
    click(true, false);
    click(true, true);
    expect(onNavigate).toHaveBeenNthCalledWith(1, entry(), { folder: false });
    expect(onNavigate).toHaveBeenNthCalledWith(2, entry(), { folder: true });
  });

  it('consulta el selector con IDs hijos ambiguos', () => {
    const beta = entry({ id: '21.11+', label: '21.11+ Beta', title: 'Beta' });
    const alfa = entry({ id: '21.11+', label: '21.11+ Alfa', title: 'Alfa' });
    const onAmbiguous = vi.fn();
    jdexDecorationProvider({ ids: () => [beta, alfa], onNavigate: vi.fn(), onAmbiguous }).onClick?.({
      noteId: 'n', from: 0, to: 6, data: '21.11+',
      pointer: { x: 0, y: 0, button: 0, alt: false, ctrl: false, meta: true, shift: false }
    });
    expect(onAmbiguous).toHaveBeenCalledWith([alfa, beta], { folder: false });
  });

  it('completa en posiciones absolutas, respeta el sistema y excluye IDs hijos', async () => {
    const fake = createFakePluginApiV2({ capabilities: ['editor'] });
    registerJdexEditor(fake.api.editor, {
      ids: () => [entry(), entry({ system: 'D01' }), entry({ id: '21.12+' })],
      onNavigate: vi.fn()
    });
    await fake.settle();
    expect(await fake.editor.complete({ line: 'Ver D01.21.1', lineFrom: 100, pos: 112 })).toEqual({
      from: 104, to: 112, options: [{ label: 'D01.21.11', detail: 'Hebra', apply: 'D01.21.11' }]
    });
    expect(await fake.editor.complete({ line: 'abc21.1' })).toBeNull();
    await fake.dispose();
  });

  it('mantiene las sugerencias al teclear los dígitos después del punto', () => {
    const provider = jdexCompletionProvider({ ids: () => [entry()], onNavigate: vi.fn() });
    for (const line of ['21.', '21.1', '21.11']) {
      expect(provider.triggers).toContain(line.at(-1));
      expect(provider.provide({ noteId: 'n', line, lineFrom: 0, pos: line.length, explicit: false })).toMatchObject({
        options: [{ label: '21.11' }]
      });
    }
  });

  it('la opción de enlace sustituye [[ sin duplicarlo y el ajuste apagado no sugiere', async () => {
    const fake = createFakePluginApiV2({ capabilities: ['editor'] });
    let enabled = true;
    registerJdexEditor(fake.api.editor, {
      ids: () => [entry()], onNavigate: vi.fn(),
      autocomplete: () => enabled, autocompleteInsert: () => 'link'
    });
    await fake.settle();
    expect(await fake.editor.complete({ line: 'Ver [[21.1', lineFrom: 20, pos: 30 })).toEqual({
      from: 26, to: 30, options: [{ label: '21.11', detail: 'Hebra', apply: '21.11 Hebra]]' }]
    });
    enabled = false;
    expect(await fake.editor.complete({ line: '21.1' })).toBeNull();
    await fake.dispose();
  });

  it('una entrada sin nota no borra el [[ escrito al elegirla', async () => {
    const fake = createFakePluginApiV2({ capabilities: ['editor'] });
    registerJdexEditor(fake.api.editor, {
      ids: () => [entry({ notePath: undefined })], onNavigate: vi.fn(),
      autocompleteInsert: () => 'link'
    });
    await fake.settle();
    expect(await fake.editor.complete({ line: 'Ver [[21.1' })).toEqual({
      from: 6, to: 10, options: [{ label: '21.11', detail: 'Hebra', apply: '21.11' }]
    });
    await fake.dispose();
  });
});
