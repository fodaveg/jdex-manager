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
  const press = (target: Element, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it('un clic simple sobre el número NO navega ni cancela el evento (la edición sigue siendo del editor)', () => {
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11 aquí.', { ids: () => [entry()], onNavigate });
    const mark = view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement;
    const onNumber = press(mark);
    // Control: el editor trata igual un clic sobre texto cualquiera (CodeMirror coloca el
    // cursor y es quien cancela el evento); la extensión no añade nada por ser un número.
    const onPlainText = press(view.contentDOM);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onNumber.defaultPrevented).toBe(onPlainText.defaultPrevented);
    view.destroy();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])('⌘/Ctrl+clic navega a la NOTA por defecto (%o)', (modifier) => {
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11 aquí.', { ids: () => [entry()], onNavigate });
    const mark = view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement;
    const event = press(mark, modifier);
    expect(onNavigate).toHaveBeenCalledWith(entry(), { folder: false });
    expect(event.defaultPrevented).toBe(true);
    view.destroy();
  });

  it('⌘/Ctrl+Alt+clic pide la carpeta', () => {
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11 aquí.', { ids: () => [entry()], onNavigate });
    press(view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement, { ctrlKey: true, altKey: true });
    expect(onNavigate).toHaveBeenCalledWith(entry(), { folder: true });
    view.destroy();
  });

  it('dos hijos + con el mismo número: pregunta con los dos, ordenados, y no navega al último', () => {
    const beta = entry({ id: '21.11+', label: '21.11+ Beta', title: 'Beta' });
    const alfa = entry({ id: '21.11+', label: '21.11+ Alfa', title: 'Alfa' });
    const onNavigate = vi.fn();
    const onAmbiguous = vi.fn();
    const view = editor('Ver 21.11+ aquí.', { ids: () => [beta, alfa], onNavigate, onAmbiguous });
    press(view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onAmbiguous).toHaveBeenCalledWith([alfa, beta], { folder: false });
    view.destroy();
  });

  it('sin onAmbiguous, abre el primero por etiqueta (determinista)', () => {
    const beta = entry({ id: '21.11+', label: '21.11+ Beta', title: 'Beta' });
    const alfa = entry({ id: '21.11+', label: '21.11+ Alfa', title: 'Alfa' });
    const onNavigate = vi.fn();
    const view = editor('Ver 21.11+ aquí.', { ids: () => [beta, alfa], onNavigate });
    press(view.dom.querySelector('.cm-hebra-jdex-number') as HTMLElement, { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledWith(alfa, { folder: false });
    view.destroy();
  });
});

describe('jdexEditorExtension — contextos que no son prosa', () => {
  it.each([
    ['código en línea', 'Ver `21.11` aquí'],
    ['bloque de código', 'Ver\n```\n21.11\n```\n'],
    ['wikilink', 'Ver [[21.11 Hebra]] aquí'],
    ['propiedades', '---\nid: 21.11\n---\ncuerpo']
  ])('no decora un número dentro de %s', (_name, text) => {
    const view = editor(text, { ids: () => [entry()], onNavigate: vi.fn() });
    expect(view.dom.querySelectorAll('.cm-hebra-jdex-number')).toHaveLength(0);
    view.destroy();
  });

  it('sí decora el de la prosa que sigue a un bloque de código', () => {
    const view = editor('```\n21.11\n```\nluego 21.11', { ids: () => [entry()], onNavigate: vi.fn() });
    expect(view.dom.querySelectorAll('.cm-hebra-jdex-number')).toHaveLength(1);
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

  it.each(['', 'D01.', 'D02.'])('completa solo el sistema escrito (%s), sin tomar el sufijo local', (prefix) => {
    const ids = [entry(), entry({ system: 'D01' }), entry({ system: 'D02' })];
    const text = `Ver ${prefix}21.1`;
    const view = editor(text, { ids: () => ids, onNavigate: vi.fn() });
    const result = source(view)(new CompletionContext(view.state, view.state.doc.length, false)) as { from: number; options: { label: string }[] };
    expect(result.options.map((option) => option.label)).toEqual([`${prefix}21.11`]);
    expect(result.from).toBe(4);
    view.destroy();
  });

  it.each(['xD01.21.1', 'abc21.1', '21.21.1', '12321.1'])('no completa un sufijo dentro de %s', (text) => {
    const view = editor(text, { ids: () => [entry(), entry({ system: 'D01' })], onNavigate: vi.fn() });
    expect(source(view)(new CompletionContext(view.state, view.state.doc.length, false))).toBeNull();
    view.destroy();
  });

  it('sin ninguna coincidencia, no hay menú', () => {
    const view = editor('99.9', { ids: () => [entry()], onNavigate: vi.fn() });
    const context = new CompletionContext(view.state, view.state.doc.length, false);
    const result = source(view)(context);
    expect(result).toBeNull();
    view.destroy();
  });

  it.each(['tengo 2', 'hay 21', 'p. 7', 'en 2026 hubo 3'])('un número suelto («%s») no abre el menú', (text) => {
    const view = editor(text, { ids: () => [entry()], onNavigate: vi.fn() });
    expect(source(view)(new CompletionContext(view.state, view.state.doc.length, false))).toBeNull();
    view.destroy();
  });

  it('la lista de 21.1 no ofrece los hijos +', () => {
    const ids = [entry(), entry({ id: '21.11+', label: '21.11+ Hijo', title: 'Hijo' })];
    const view = editor('21.1', { ids: () => ids, onNavigate: vi.fn() });
    const result = source(view)(new CompletionContext(view.state, view.state.doc.length, false)) as { options: { label: string }[] };
    expect(result.options.map((o) => o.label)).toEqual(['21.11']);
    view.destroy();
  });

  it('con el ajuste apagado no hay fuente (y se lee en cada consulta)', () => {
    let on = false;
    const view = editor('21.1', { ids: () => [entry()], onNavigate: vi.fn(), autocomplete: () => on });
    expect(source(view)).toBeUndefined();
    on = true;
    expect(source(view)).toBeDefined();
    view.destroy();
  });

  it('autocompleteInsert «link» inserta [[nota]] y respeta un [[ ya tecleado', () => {
    const view = editor('Ver [[21.1', { ids: () => [entry()], onNavigate: vi.fn(), autocompleteInsert: () => 'link' });
    const result = source(view)(new CompletionContext(view.state, view.state.doc.length, false)) as {
      from: number;
      options: { apply: (v: EditorView, c: unknown, from: number, to: number) => void }[];
    };
    result.options[0].apply(view, {}, result.from, view.state.doc.length);
    expect(view.state.doc.toString()).toBe('Ver [[21.11 Hebra]]');
    view.destroy();
  });

  it('autocompleteInsert «number» (o sin ajuste) inserta el número a secas', () => {
    const view = editor('21.1', { ids: () => [entry()], onNavigate: vi.fn() });
    const result = source(view)(new CompletionContext(view.state, view.state.doc.length, false)) as { options: { apply: unknown }[] };
    expect(result.options[0].apply).toBe('21.11');
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
