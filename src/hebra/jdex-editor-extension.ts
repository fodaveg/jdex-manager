/** JDex numbers and completions for Hebra's declarative editor API. */
import type { PluginCompletionProvider, PluginDecorationProvider, PluginEditor, PluginUnregister } from 'hebra-plugin-api/v2';
import { entriesByNumber, findJdNumbers, systemKey, type IdEntry } from './engine';
import { maskNonProse } from './jdex-markdown-contexts';

export interface JdexNavigateOptions {
  /** Open the ID folder on Alt+primary click. */
  folder: boolean;
}

export interface JdexEditorExtensionContext {
  ids(): readonly IdEntry[];
  onNavigate(entry: IdEntry, options?: JdexNavigateOptions): void;
  onAmbiguous?(entries: readonly IdEntry[], options: JdexNavigateOptions): void;
  autocomplete?(): boolean;
  autocompleteInsert?(): 'link' | 'number';
}

const JD_NUMBER_PARTIAL = /(?:[A-Z]\d{2}\.)?\d{2}\.\d{0,2}$/;
const JD_COMPLETION_LIMIT = 50;

/** The host sends only the visible slice; positions returned here refer to the full note. */
export function jdexDecorationProvider(ctx: JdexEditorExtensionContext): PluginDecorationProvider {
  return {
    id: 'jdex-numbers',
    provide({ text, offset }) {
      const byId = entriesByNumber(ctx.ids());
      if (byId.size === 0) return [];
      const exists = (id: string, system?: string): boolean => byId.has(systemKey(id, system));
      return findJdNumbers(maskNonProse(text), exists).map((match) => ({
        from: offset + match.start,
        to: offset + match.end,
        style: 'link' as const,
        clickable: true,
        clickModifier: 'mod' as const,
        data: systemKey(match.id, match.system)
      }));
    },
    onClick({ data, pointer }) {
      if (pointer.button !== 0 || (!pointer.meta && !pointer.ctrl) || !data) return;
      const entries = entriesByNumber(ctx.ids()).get(data);
      if (!entries?.length) return;
      const options = { folder: pointer.alt };
      if (entries.length > 1 && ctx.onAmbiguous) ctx.onAmbiguous(entries, options);
      else ctx.onNavigate(entries[0], options);
    }
  };
}

/** Find a partial ID immediately before the cursor, respecting system prefixes. */
function completionTarget(line: string, lineFrom: number, pos: number): { from: number; query: string } | null {
  const column = pos - lineFrom;
  const before = line.slice(Math.max(0, column - 12), column);
  const match = JD_NUMBER_PARTIAL.exec(before);
  if (!match) return null;
  const start = column - match[0].length;
  if (start > 0 && /[\p{L}\p{N}_.]/u.test(line[start - 1])) return null;
  return { from: lineFrom + start, query: match[0] };
}

function linkText(notePath: string): string {
  const base = notePath.slice(notePath.lastIndexOf('/') + 1);
  return `[[${base.endsWith('.md') ? base.slice(0, -3) : base}]]`;
}

/** The provider reads settings and the current index on every request. */
export function jdexCompletionProvider(ctx: JdexEditorExtensionContext): PluginCompletionProvider {
  return {
    id: 'jdex-ids',
    // The host asks only providers whose trigger matches the latest typed character.
    // Keep querying as the user types the digits after the dot.
    triggers: ['.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    provide({ line, lineFrom, pos }) {
      if (ctx.autocomplete?.() === false) return null;
      const target = completionTarget(line, lineFrom, pos);
      if (!target) return null;
      const insert = ctx.autocompleteInsert?.() ?? 'number';
      const hasOpenLink = line.slice(target.from - lineFrom - 2, target.from - lineFrom) === '[[';
      const options = ctx.ids()
        .filter((entry) => !entry.id.endsWith('+') && systemKey(entry.id, entry.system).startsWith(target.query))
        .slice(0, JD_COMPLETION_LIMIT)
        .map((entry) => ({
          label: systemKey(entry.id, entry.system),
          detail: entry.title,
          apply: insert === 'link' && entry.notePath
            ? (hasOpenLink ? linkText(entry.notePath).slice(2) : linkText(entry.notePath))
            : systemKey(entry.id, entry.system)
        }));
      if (!options.length) return null;
      return { from: target.from, options };
    }
  };
}

/** Register both providers and remove them together at shutdown. */
export function registerJdexEditor(editor: PluginEditor, ctx: JdexEditorExtensionContext): PluginUnregister {
  const offDecorations = editor.registerDecorations(jdexDecorationProvider(ctx));
  try {
    const offCompletion = editor.registerCompletion(jdexCompletionProvider(ctx));
    return () => { offCompletion(); offDecorations(); };
  } catch (error) {
    offDecorations();
    throw error;
  }
}
