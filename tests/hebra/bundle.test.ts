// @vitest-environment happy-dom
//
// El módulo que Hebra de verdad descarga: `hebra-main.mjs` (lo genera `npm run build:hebra`,
// y `npm run check` lo construye ANTES de correr los tests). Se carga como lo haría Hebra
// (un módulo ES con el registro de módulos compartidos publicado en `globalThis`) y se
// activa contra el host falso: prueba que el bundle exporta `activate`, que no necesita nada
// más que lo prestado y que su extensión de editor usa el `@codemirror/state` PRESTADO
// (una copia propia no la reconocería el `EditorState` de Hebra).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { PLUGIN_SHARED_GLOBAL_KEY } from 'hebra-plugin-api/shared';
import * as codemirrorState from '@codemirror/state';
import * as codemirrorView from '@codemirror/view';
import { describe, expect, it } from 'vitest';

// vitest corre desde la raíz del repo.
const ROOT = cwd();
const BUNDLE = join(ROOT, 'hebra-main.mjs');
const MANIFEST = join(ROOT, 'hebra.json');

describe.runIf(existsSync(BUNDLE))('hebra-main.mjs (hay que construirlo: npm run build:hebra)', () => {
  it('se carga con el registro de módulos compartidos y se activa contra la API', async () => {
    (globalThis as Record<symbol, unknown>)[Symbol.for(PLUGIN_SHARED_GLOBAL_KEY)] = {
      modules: {
        '@codemirror/state': { version: '6.7.6', namespace: codemirrorState },
        '@codemirror/view': { version: '6.43.13', namespace: codemirrorView }
      }
    };
    // La ruta es una constante de este fichero, no entrada de nadie.
    // eslint-disable-next-line no-unsanitized/method
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(BUNDLE).href)) as {
      activate(api: unknown): Promise<() => Promise<void> | void>;
    };
    expect(typeof loaded.activate).toBe('function');

    const fake = createFakePluginApi({ capabilities: ['vault.read', 'vault.write', 'editor'] });
    const cleanup = await loaded.activate(fake.api);
    expect(fake.recorded.commands.length).toBeGreaterThan(10);
    expect(fake.recorded.extensions).toHaveLength(1);
    // La extensión usa el `@codemirror/state` prestado: el mismo `EditorState` la acepta.
    const state = codemirrorState.EditorState.create({
      doc: 'Ver 21.11',
      extensions: fake.recorded.extensions
    });
    expect(state.doc.toString()).toBe('Ver 21.11');

    await cleanup();
    expect(fake.recorded.commands).toHaveLength(0);
  });

  it('hebra.json describe ese módulo: versión de package.json y sha256 de lo publicado', async () => {
    const { createHash } = await import('node:crypto');
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      version: string;
      files: Record<string, string>;
      shared: Record<string, string>;
    };
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe(pkg.version);
    for (const [name, hash] of Object.entries(manifest.files)) {
      const digest = createHash('sha256').update(readFileSync(join(ROOT, name))).digest('hex');
      expect(hash).toBe(`sha256:${digest}`);
    }
    expect(Object.keys(manifest.files).sort()).toEqual(['hebra-main.mjs', 'hebra-styles.css']);
    expect(Object.keys(manifest.shared).sort()).toEqual(['@codemirror/state', '@codemirror/view']);
  });
});
