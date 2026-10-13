// @vitest-environment happy-dom
//
// El módulo que Hebra de verdad descarga: `hebra-main.mjs` (lo genera `npm run build:hebra`,
// y `npm run check` lo construye ANTES de correr los tests). Se carga como lo haría Hebra
// (un módulo ES autocontenido) y se activa contra el host falso de la API 2.0.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it } from 'vitest';

// vitest corre desde la raíz del repo.
const ROOT = cwd();
const BUNDLE = join(ROOT, 'hebra-main.mjs');
const MANIFEST = join(ROOT, 'hebra.json');

// No `runIf`: a missing bundle must turn this file red, not skip it silently. `npm run check`
// builds it first; running vitest on its own needs `npm run build:hebra` beforehand.
describe('hebra-main.mjs (hay que construirlo: npm run build:hebra)', () => {
  it('existe (si falta: npm run build:hebra)', () => {
    expect(existsSync(BUNDLE), `${BUNDLE} no existe: ejecuta npm run build:hebra`).toBe(true);
    expect(existsSync(MANIFEST), `${MANIFEST} no existe: ejecuta npm run build:hebra`).toBe(true);
  });

  it('se carga sin módulos compartidos y registra los proveedores declarativos', async () => {
    // La ruta es una constante de este fichero, no entrada de nadie.
    // eslint-disable-next-line no-unsanitized/method
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(BUNDLE).href)) as {
      activate(api: unknown): Promise<() => Promise<void> | void>;
    };
    expect(typeof loaded.activate).toBe('function');

    const fake = createFakePluginApiV2({ capabilities: ['vault.read', 'vault.write', 'editor'] });
    // The published fake leaves storage.device unavailable unless an L14 namespace is
    // supplied. This activation needs only its synchronous get/set mirror.
    const storage = new Proxy({}, {
      get(_target, key) {
        return key === 'device'
          ? fake.host.api.storage.device
          : Reflect.get(fake.api.storage, key) as unknown;
      }
    });
    const api = new Proxy({}, {
      get(_target, key) {
        if (key === 'storage') return storage;
        // The published fake has no L5 surface manager. Its backing host records views.
        if (key === 'ui') return fake.host.api.ui;
        return Reflect.get(fake.api, key) as unknown;
      }
    });
    const cleanup = await loaded.activate(api);
    await fake.settle();
    expect(fake.recorded.commands.length).toBeGreaterThan(10);
    expect(fake.editor.providers()).toEqual({ decorations: ['jdex-numbers'], completions: ['jdex-ids'] });

    await cleanup();
    await fake.settle();
    expect(fake.recorded.commands).toHaveLength(0);
    expect(fake.editor.providers()).toEqual({ decorations: [], completions: [] });
  });

  it('hebra.json describe ese módulo: versión de package.json y sha256 de lo publicado', async () => {
    const { createHash } = await import('node:crypto');
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      version: string;
      apiVersion: string;
      files: Record<string, string>;
      shared: Record<string, string>;
    };
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.apiVersion).toBe('^2.1.0');
    for (const [name, hash] of Object.entries(manifest.files)) {
      const digest = createHash('sha256').update(readFileSync(join(ROOT, name))).digest('hex');
      expect(hash).toBe(`sha256:${digest}`);
    }
    expect(Object.keys(manifest.files).sort()).toEqual(['hebra-main.mjs', 'hebra-styles.css']);
    expect(manifest.shared).toEqual({});
  });
});
