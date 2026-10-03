/**
 * «Los números JD (AC.ID) son clicables y llevan a su nota o carpeta, y hay
 * autocompletado de IDs al escribir» (lote 4, tarea 2, encargo de David, 28 sep 2026):
 * la extensión de CodeMirror que el runtime perezoso registra con
 * `host.registerEditorExtension` (`host-ui.ts`, punto nuevo, mínimo y aditivo).
 *
 * El motor puro solo ENCUENTRA los números (`findJdNumbers`, contrato del 28 sep,
 * punto 6): decorarlos, resolver el clic y ofrecer las sugerencias es cosa del host,
 * igual que `wikilinkNavigation` (`editor/wikilink-navigation.ts`) pinta y resuelve
 * los wikilinks. Tres piezas, cada una un `Extension`:
 *
 * 1. `ViewPlugin` que decora los números encontrados en el VIEWPORT visible (nunca el
 *    documento entero: una nota grande no paga un escaneo completo por tecla) con
 *    `.cm-hebra-jdex-number` (`jdex-host.css`).
 * 2. `domEventHandlers.mousedown`: como `wikilinkNavigation`, resuelve por
 *    `posAtDOM(element)` (hit-test real del navegador), nunca por coordenadas.
 * 3. Una fuente de autocompletado (`EditorState.languageData.of`, el mismo mecanismo
 *    que `tagCompletionSource`/`highlightColorMenu`) que sugiere IDs mientras se
 *    teclea un número: elegir una inserta el ID a secas (el enlace lo pinta la pieza 1,
 *    en cuanto `exists(id)` sea `true`).
 *
 * `ids()` se llama en cada repintado y en cada tecla: SIEMPRE la lista viva
 * (`index.ids` del runtime tras el último `rebuild()`), nunca una copia congelada al
 * registrar la extensión — un ID creado después de abrir la nota tiene que quedar
 * clicable sin remontar el editor.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import { findJdNumbers, type IdEntry } from './engine';

export interface JdexEditorExtensionContext {
  /** Todos los IDs vivos ahora mismo. */
  ids(): readonly IdEntry[];
  /** El destino de un número JD reconocido: su carpeta si la tiene, si no su nota. */
  onNavigate(entry: IdEntry): void;
}

const JDEX_NUMBER_CLASS = 'cm-hebra-jdex-number';

function idIndex(ctx: JdexEditorExtensionContext): Map<string, IdEntry> {
  return new Map(ctx.ids().map((entry) => [entry.id, entry]));
}

function buildDecorations(view: EditorView, ctx: JdexEditorExtensionContext): DecorationSet {
  const byId = idIndex(ctx);
  if (byId.size === 0) return Decoration.none;
  const exists = (id: string): boolean => byId.has(id);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of findJdNumbers(text, exists)) {
      builder.add(
        from + match.start,
        from + match.end,
        Decoration.mark({ class: JDEX_NUMBER_CLASS })
      );
    }
  }
  return builder.finish();
}

function jdexNumberElementAt(event: MouseEvent): Element | null {
  return event.target instanceof Element ? event.target.closest(`.${JDEX_NUMBER_CLASS}`) : null;
}

function jdexDecorationExtension(ctx: JdexEditorExtensionContext): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, ctx);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, ctx);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

/** Como `wikilinkNavigation` (`editor/wikilink-navigation.ts`): resuelve en
 *  `mousedown`, por `posAtDOM` del elemento pulsado, nunca por coordenadas. Sin el
 *  gesto de arrastre/soltar de los wikilinks (los números JD no llevan alias que
 *  revelar al enfocar la línea), un `mousedown` directo basta. */
function jdexClickExtension(ctx: JdexEditorExtensionContext): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, editor) {
      if (event.button !== 0 || event.defaultPrevented) return false;
      const element = jdexNumberElementAt(event);
      if (!element) return false;
      let position: number;
      try {
        position = editor.posAtDOM(element);
      } catch {
        return false;
      }
      const byId = idIndex(ctx);
      const exists = (id: string): boolean => byId.has(id);
      const text = editor.state.doc.toString();
      const match = findJdNumbers(text, exists).find(
        (candidate) => position >= candidate.start && position <= candidate.end
      );
      if (!match) return false;
      const entry = byId.get(match.id);
      if (!entry) return false;
      event.preventDefault();
      ctx.onNavigate(entry);
      return true;
    }
  });
}

/** `\d{1,2}` o `\d{1,2}\.\d{0,2}` justo antes del cursor: lo mínimo de un número JD a
 *  medio escribir («21» o «21.1»). Sin punto todavía no distingue de un número
 *  cualquiera, pero como fuente de autocompletado (nunca valida por su cuenta) eso es
 *  aceptable: sin coincidencias no aparece menú. */
const JD_NUMBER_PARTIAL = /\d{1,2}(?:\.\d{0,2})?$/;
/** Máximo de sugerencias por tecleo (como el buscador de «ir a un ID»). */
const JD_COMPLETION_LIMIT = 50;

/** Escaneo propio del texto, como `tagCompletionTarget`/`highlightMenuTarget`
 *  (`LibraryEditor.svelte` y `editor/highlight-color-menu.ts`): NINGUNA fuente de
 *  autocompletado de Hebra usa `CompletionContext.matchBefore`, y el motivo es
 *  medido, no estilo — con `matchBefore` la fuente SÍ se invocaba y SÍ devolvía
 *  opciones (confirmado con un `console.log` dentro, en un navegador real), pero el
 *  desplegable nunca llegaba a pintarse: ni con el disparo automático al teclear ni
 *  forzado con Ctrl+Espacio. Ventana corta (10 caracteres): un número JD nunca es
 *  más largo. */
function jdNumberCompletionTarget(
  text: string,
  pos: number
): { from: number; query: string } | null {
  const from = Math.max(0, pos - 10);
  const before = text.slice(from, pos);
  const match = JD_NUMBER_PARTIAL.exec(before);
  if (!match) return null;
  return { from: pos - match[0].length, query: match[0] };
}

function jdexIdCompletionSource(
  ctx: JdexEditorExtensionContext
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const target = jdNumberCompletionTarget(context.state.doc.toString(), context.pos);
    if (!target) return null;
    const options: Completion[] = ctx
      .ids()
      .filter((entry) => entry.id.startsWith(target.query))
      .slice(0, JD_COMPLETION_LIMIT) // slice-seguro: array de IDs, no texto.
      .map((entry) => ({ label: entry.id, detail: entry.title, apply: entry.id }));
    if (options.length === 0) return null;
    return { from: target.from, options, filter: false };
  };
}

function jdexCompletionExtension(ctx: JdexEditorExtensionContext): Extension {
  // `source` se crea UNA sola vez: CM6 sigue el estado de cada fuente entre
  // transacciones por IGUALDAD DE REFERENCIA de la función (`ActiveSource`,
  // `@codemirror/autocomplete`). Devolverla desde dentro del proveedor de
  // `languageData` (`() => [{ autocomplete: jdexIdCompletionSource(ctx) }]`, una
  // función NUEVA en cada tecla) le impedía reconocerla como la MISMA fuente entre
  // dos teclas seguidas: la fuente respondía con opciones válidas (medido con un
  // `console.log` dentro), pero el desplegable nunca llegaba a pintarse, ni al
  // teclear ni forzado con Ctrl+Espacio — mismo síntoma que `tagCompletionSource`/
  // `highlightColorCompletionSource` NO tienen, porque son referencias estables
  // desde el principio (una función de módulo, no una fábrica con clausura).
  const source = jdexIdCompletionSource(ctx);
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

export function jdexEditorExtension(ctx: JdexEditorExtensionContext): Extension {
  return [jdexDecorationExtension(ctx), jdexClickExtension(ctx), jdexCompletionExtension(ctx)];
}
