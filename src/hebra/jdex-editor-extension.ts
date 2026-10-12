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
import { EditorState, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import { entriesByNumber, findJdNumbers, systemKey, type IdEntry } from './engine';
import { maskNonProse } from './jdex-markdown-contexts';

export interface JdexNavigateOptions {
  /** `true` = la carpeta del ID (⌘/Ctrl+Alt+clic); por defecto, su nota. */
  folder: boolean;
}

export interface JdexEditorExtensionContext {
  /** Todos los IDs vivos ahora mismo. */
  ids(): readonly IdEntry[];
  /** El destino de un número JD reconocido: su nota por defecto, su carpeta si se pide. */
  onNavigate(entry: IdEntry, options?: JdexNavigateOptions): void;
  /** Varios hijos `AC.ID+` comparten número y se distinguen por título: el host pregunta cuál.
   *  Sin ella se abre el primero por etiqueta, nunca «el último que escribió el mapa». */
  onAmbiguous?(entries: readonly IdEntry[], options: JdexNavigateOptions): void;
  /** Ajuste `autocomplete`; sin función, activado. Se lee en cada consulta. */
  autocomplete?(): boolean;
  /** Ajuste `autocompleteInsert`; sin función, `number`. */
  autocompleteInsert?(): 'link' | 'number';
  /** The index changed: each open editor registers a repaint here (and unregisters when it
   *  is destroyed), so numbers created, received or removed repaint without an edit. */
  subscribe?(repaint: () => void): () => void;
}

/** Repaint the number decorations against the current `ids()`, without editing. */
const jdexIndexChanged = StateEffect.define<null>();

const JDEX_NUMBER_CLASS = 'cm-hebra-jdex-number';

/** Número (con prefijo de sistema) → TODAS las entradas que lo comparten. */
function idIndex(ctx: JdexEditorExtensionContext): Map<string, IdEntry[]> {
  return entriesByNumber(ctx.ids());
}

function buildDecorations(view: EditorView, ctx: JdexEditorExtensionContext): DecorationSet {
  const byId = idIndex(ctx);
  if (byId.size === 0) return Decoration.none;
  const exists = (id: string, system?: string): boolean => byId.has(systemKey(id, system));
  const builder = new RangeSetBuilder<Decoration>();
  // Los contextos que no son prosa (propiedades, código, wikilinks…) dependen de líneas
  // anteriores al viewport; se enmascara el documento (lineal) y solo se decora lo visible.
  const masked = maskNonProse(view.state.doc.toString());
  for (const { from, to } of view.visibleRanges) {
    for (const match of findJdNumbers(masked.slice(from, to), exists)) {
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
      private readonly unsubscribe: () => void;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, ctx);
        this.unsubscribe = ctx.subscribe?.(() => {
          try {
            view.dispatch({ effects: jdexIndexChanged.of(null) });
          } catch {
            // A view torn down meanwhile, or mid-update: its next update repaints anyway.
          }
        }) ?? (() => {});
      }
      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((tr) => tr.effects.some((effect) => effect.is(jdexIndexChanged)))
        ) {
          this.decorations = buildDecorations(update.view, ctx);
        }
      }
      destroy(): void {
        this.unsubscribe();
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

/** Como `wikilinkNavigation` (`editor/wikilink-navigation.ts`): resuelve por `posAtDOM` del
 *  elemento pulsado, nunca por coordenadas. Solo con ⌘/Ctrl: un clic simple coloca el cursor
 *  y selecciona como en cualquier texto, sin navegar ni cancelar el evento (con ⌘/Ctrl+Alt, la
 *  carpeta en vez de la nota). */
function jdexClickExtension(ctx: JdexEditorExtensionContext): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, editor) {
      if (event.button !== 0 || event.defaultPrevented) return false;
      if (!event.metaKey && !event.ctrlKey) return false;
      const element = jdexNumberElementAt(event);
      if (!element) return false;
      let position: number;
      try {
        position = editor.posAtDOM(element);
      } catch {
        return false;
      }
      const byId = idIndex(ctx);
      const exists = (id: string, system?: string): boolean => byId.has(systemKey(id, system));
      const text = maskNonProse(editor.state.doc.toString());
      const match = findJdNumbers(text, exists).find(
        (candidate) => position >= candidate.start && position <= candidate.end
      );
      if (!match) return false;
      const entries = byId.get(systemKey(match.id, match.system));
      if (!entries || entries.length === 0) return false;
      event.preventDefault();
      const options: JdexNavigateOptions = { folder: event.altKey };
      if (entries.length > 1 && ctx.onAmbiguous) ctx.onAmbiguous(entries, options);
      else ctx.onNavigate(entries[0], options);
      return true;
    }
  });
}

/** `NN.` y hasta dos cifras más justo antes del cursor, con prefijo de sistema opcional: lo
 *  mínimo de un número JD a medio escribir («21.», «21.1»). Sin el punto no se ofrece nada:
 *  «tengo 2», «hay 21» o «p. 7» no son el comienzo de un ID y el menú robaría el Enter. */
const JD_NUMBER_PARTIAL = /(?:[A-Z]\d{2}\.)?\d{2}\.\d{0,2}$/;
/** Máximo de sugerencias por tecleo (como el buscador de «ir a un ID»). */
const JD_COMPLETION_LIMIT = 50;

/** Escaneo propio del texto, como `tagCompletionTarget`/`highlightMenuTarget`
 *  (`LibraryEditor.svelte` y `editor/highlight-color-menu.ts`): NINGUNA fuente de
 *  autocompletado de Hebra usa `CompletionContext.matchBefore`, y el motivo es
 *  medido, no estilo — con `matchBefore` la fuente SÍ se invocaba y SÍ devolvía
 *  opciones (confirmado con un `console.log` dentro, en un navegador real), pero el
 *  desplegable nunca llegaba a pintarse: ni con el disparo automático al teclear ni
 *  forzado con Ctrl+Espacio. Ventana corta (12 caracteres), incluido el prefijo de sistema; se comprueba
 *  además el carácter anterior para no completar un sufijo de otro número. */
function jdNumberCompletionTarget(
  text: string,
  pos: number
): { from: number; query: string } | null {
  const from = Math.max(0, pos - 12);
  const before = text.slice(from, pos);
  const match = JD_NUMBER_PARTIAL.exec(before);
  if (!match) return null;
  const start = pos - match[0].length;
  if (start > 0 && /[\p{L}\p{N}_.]/u.test(text[start - 1])) return null;
  return { from: start, query: match[0] };
}

/** Inserta `[[nota]]` (con el `[[` ya tecleado, si lo hay) en vez del número. */
function linkApply(notePath: string): Completion['apply'] {
  const base = notePath.slice(notePath.lastIndexOf('/') + 1);
  const name = base.endsWith('.md') ? base.slice(0, -3) : base;
  return (view, _completion, from, to) => {
    const start = view.state.doc.sliceString(Math.max(0, from - 2), from) === '[[' ? from - 2 : from;
    const text = `[[${name}]]`;
    view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length } });
  };
}

function jdexIdCompletionSource(
  ctx: JdexEditorExtensionContext
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const target = jdNumberCompletionTarget(context.state.doc.toString(), context.pos);
    if (!target) return null;
    // Los hijos `+` comparten número y no se pueden distinguir en el texto: fuera.
    const insert = ctx.autocompleteInsert?.() ?? 'number';
    const options: Completion[] = ctx
      .ids()
      .filter((entry) => !entry.id.endsWith('+') && systemKey(entry.id, entry.system).startsWith(target.query))
      .slice(0, JD_COMPLETION_LIMIT) // slice-seguro: array de IDs, no texto.
      .map((entry) => ({
        label: systemKey(entry.id, entry.system),
        detail: entry.title,
        apply: insert === 'link' && entry.notePath ? linkApply(entry.notePath) : systemKey(entry.id, entry.system)
      }));
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
  // Con el ajuste apagado el proveedor no devuelve fuente alguna (se lee en cada consulta).
  return EditorState.languageData.of(() => (ctx.autocomplete?.() === false ? [] : [{ autocomplete: source }]));
}

export function jdexEditorExtension(ctx: JdexEditorExtensionContext): Extension {
  return [jdexDecorationExtension(ctx), jdexClickExtension(ctx), jdexCompletionExtension(ctx)];
}
