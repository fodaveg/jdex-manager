// Why `^6.5.0` / `^6.30.0` in hebra.json: every CodeMirror symbol the Hebra plugin takes from
// Hebra's shared modules must exist in the MINIMUM declared version (installed under an alias
// pinned to exactly that lower bound). See scripts/shared-symbols.mjs for the method and its limit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as symbols from '../../scripts/shared-symbols.mjs';
// @ts-expect-error plain .mjs script without types
import * as build from '../../scripts/build-hebra.mjs';

const { usedSharedSymbols, missingInMinimum, hebraSources, MINIMUM_ALIASES } = symbols as {
  usedSharedSymbols: (sources: Record<string, string>) => Record<string, Set<string>>;
  missingInMinimum: (used: Record<string, Set<string>>) => string[];
  hebraSources: () => Record<string, string>;
  MINIMUM_ALIASES: Record<string, string>;
};
const { SHARED_RANGES } = build as { SHARED_RANGES: Record<string, string> };

const ROOT = cwd();

describe('CodeMirror minimums declared for Hebra', () => {
  it('the aliases installed for the check are exactly the lower bound of each declared range', () => {
    for (const [module, alias] of Object.entries(MINIMUM_ALIASES)) {
      const installed = (JSON.parse(readFileSync(join(ROOT, 'node_modules', alias, 'package.json'), 'utf8')) as { version: string }).version;
      expect(`^${installed}`, `${alias} must equal the minimum of ${module}`).toBe(SHARED_RANGES[module]);
    }
  });

  it('finds the symbols the plugin really uses', () => {
    const used = usedSharedSymbols(hebraSources());
    expect(used['@codemirror/state']).toContain('EditorState.languageData');
    expect(used['@codemirror/view']).toContain('EditorView.domEventHandlers');
  });

  it('every symbol the plugin uses exists in the declared minimum versions', () => {
    expect(missingInMinimum(usedSharedSymbols(hebraSources()))).toEqual([]);
  });

  it('fails when the code uses a symbol or member the minimum does not declare (deliberate negative)', () => {
    const used = usedSharedSymbols({
      'probe.ts': [
        "import { EditorState, NoSuchThing } from '@codemirror/state';",
        "import { EditorView } from '@codemirror/view';",
        'EditorState.noSuchMember; EditorView.noSuchMember; void NoSuchThing;'
      ].join('\n')
    });
    expect(missingInMinimum(used)).toEqual([
      '@codemirror/state: EditorState.noSuchMember',
      '@codemirror/state: NoSuchThing',
      '@codemirror/view: EditorView.noSuchMember'
    ]);
  });
});
