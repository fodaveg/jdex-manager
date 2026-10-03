// @vitest-environment happy-dom
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdEntry } from '../../src/hebra/engine';
import { jdexEditorExtension, type JdexEditorExtensionContext } from '../../src/hebra/jdex-editor-extension';

function entry(overrides: Partial<IdEntry> = {}): IdEntry {
  return {
    id: '21.11',
    category: '21',
    title: 'Hebra',
    label: '21.11 Hebra',
    folderPath: '20-29/21/21.11 Hebra',
    notePath: '00.00 JDex/21.11 Hebra.md',
    ...overrides
  };
}

function editor(source: string, ctx: JdexEditorExtensionContext): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc: source, extensions: [jdexEditorExtension(ctx)] })
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('jdexEditorExtension — decoración', () => {
  it('decora un número JD que existe en el índice, no uno que no existe', () => {
    const view = editor('Ver 21.11 y también 99.99.', {
      ids: () => [entry()],
      onNavigate: vi.fn()
    });
    const marks = [...view.dom.querySelectorAll('.cm-hebra-jdex-number')];
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('21.11');
    view.destroy();
  });

  it('un ID creado después de montar el editor queda clicable sin remontar', () => {
    let ids: IdEntry[] = [];
    const view = editor('Ver 21.11.', { ids: () => ids, onNavigate: vi.fn() });
    expect(view.dom.querySelectorAll('.cm-hebra-jdex-number')).toHaveLength(0);
    ids = [entry()];
    // Fuerza un repintado (el `ViewPlugin` solo recalcula en `docChanged`/`viewportChanged`).
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } });
    expect(view.dom.querySelectorAll('.cm-hebra-jdex-number')).toHaveLength(1);
    view.destroy();
  });
});

describe('jdexEditorExtension — clic', () => {
  it('un mousedown sobre el número decorado navega a su entrada', () => {
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11 aquí.', { ids: () => [entry()], onNavigate });
    const mark = view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement;
    expect(mark).toBeTruthy();
    mark.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(onNavigate).toHaveBeenCalledWith(entry());
    view.destroy();
  });

  it('un mousedown fuera de un número no navega', () => {
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11 aquí.', { ids: () => [entry()], onNavigate });
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    );
    expect(onNavigate).not.toHaveBeenCalled();
    view.destroy();
  });
});

describe('jdexEditorExtension — autocompletado', () => {
  function source(view: EditorView) {
    return view.state.languageDataAt<(context: CompletionContext) => unknown>(
      'autocomplete',
      view.state.doc.length
    )[0];
  }

  it('sugiere los IDs cuyo número empieza por lo escrito', () => {
    const ids = [
      entry(),
      entry({ id: '21.12', label: '21.12 Otro' }),
      entry({ id: '22.01', label: '22.01 Ajeno' })
    ];
    const view = editor('21.1', { ids: () => ids, onNavigate: vi.fn() });
    const context = new CompletionContext(view.state, view.state.doc.length, false);
    const result = source(view)(context) as { options: { label: string }[] } | null;
    expect(result?.options.map((o) => o.label)).toEqual(['21.11', '21.12']);
    view.destroy();
  });

  it('sin ninguna coincidencia, no hay menú', () => {
    const view = editor('99.9', { ids: () => [entry()], onNavigate: vi.fn() });
    const context = new CompletionContext(view.state, view.state.doc.length, false);
    const result = source(view)(context);
    expect(result).toBeNull();
    view.destroy();
  });

  it('la fuente registrada es SIEMPRE la MISMA referencia entre dos consultas', () => {
    // Regresión: CM6 rastrea cada fuente de autocompletado entre transacciones por
    // IGUALDAD DE REFERENCIA de la función (`ActiveSource`,
    // `@codemirror/autocomplete`). Antes, `jdexCompletionExtension` llamaba a
    // `jdexIdCompletionSource(ctx)` DENTRO del proveedor de `languageData`
    // (`() => [{ autocomplete: jdexIdCompletionSource(ctx) }]`), que CM6 invoca en
    // CADA tecla: cada llamada creaba una función nueva, así que CM6 nunca
    // reconocía la fuente de la tecla anterior como la MISMA y el desplegable no
    // llegaba a pintarse nunca (medido en `library-jdex-manager-capturas.spec.ts`,
    // navegador real: la fuente SÍ se invocaba y SÍ devolvía opciones válidas, pero
    // `.cm-tooltip-autocomplete` nunca aparecía en el DOM, ni al teclear ni forzado
    // con Ctrl+Espacio).
    const view = editor('21.1', { ids: () => [entry()], onNavigate: vi.fn() });
    const first = source(view);
    const second = source(view);
    expect(first).toBe(second);
    view.destroy();
  });
});
