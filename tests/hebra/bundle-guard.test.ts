import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import * as build from '../../scripts/build-hebra.mjs';

const guardBundle = (text: string, meta: ReturnType<typeof metafile>): string[] =>
  (build as { guardBundle(text: string, meta: ReturnType<typeof metafile>): string[] }).guardBundle(text, meta);

function metafile(inputs: Record<string, number> = {}, imports: { path: string; kind: string }[] = []) {
  return { outputs: { 'hebra-main.mjs': { inputs, imports } } };
}

describe('guard del bundle Hebra 2.0', () => {
  it('acepta un módulo único sin CodeMirror', () => {
    expect(guardBundle('function activate() {} export { activate };', metafile())).toEqual([]);
  });

  it('rechaza imports sin resolver y CodeMirror empaquetado', () => {
    const problems = guardBundle(
      'function activate() {} export { activate };',
      metafile({ 'node_modules/@codemirror/state/dist/index.js': 100 }, [{ path: './extra.js', kind: 'import-statement' }])
    );
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('import sin resolver'),
      expect.stringContaining('empaqueta')
    ]));
  });
});
