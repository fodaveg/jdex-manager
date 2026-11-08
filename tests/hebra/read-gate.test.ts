// @vitest-environment happy-dom
//
// La puerta de concurrencia de las `noteRead` (`src/hebra/read-gate.ts`, tarea Lumbre
// 35c8fc55): el semáforo en sí, el envoltorio del vault/api y, de extremo a extremo, que
// `activateJdex` la aplica de verdad — un «normalizar toda la JDex» con 8 notas lanza en el
// diario un `Promise.all` de 8 `noteRead` (`jdex-journal.ts`), y con la puerta no pueden
// entrar en la cola nativa del almacén más de `MAX_CONCURRENT_NOTE_READS` a la vez.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HebraPluginApi, PluginCapability, PluginFolder, PluginNote, PluginVault } from 'hebra-plugin-api/v2';
import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import {
  MAX_CONCURRENT_NOTE_READS,
  NOTES_READ_BATCH_MAX,
  createReadGate,
  gatePluginApiNoteReads,
  gateVaultNoteReads,
  readNotes
} from '../../src/hebra/read-gate';
import { JDEX_COMMAND_NORMALIZE_ALL } from '../../src/hebra/jdex-runtime';
import { activateJdex } from './support/activate';
import {
  FAKE_ROOT_FOLDER_ID as ROOT_FOLDER_ID,
  createJdexTestApi,
  fakeFolder,
  fakeNote,
  vaultFromNotes
} from './support/fakes';

/** Un macrotask: que se resuelvan las continuaciones pendientes (sin fake timers). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Envuelve un vault contando la concurrencia real de sus `noteRead` (las que de verdad
 *  entran en la cola nativa del almacén). Con `withBatch` le añade además un
 *  `notesReadBatch` que NO pasa por el contador individual (en el host real es una sola
 *  operación de la cola, no una por nota). */
function countingReads(vault: PluginVault, withBatch = false): {
  vault: PluginVault;
  peak: () => number;
  calls: () => number;
  batchCalls: () => number;
} {
  let active = 0;
  let peak = 0;
  let calls = 0;
  let batchCalls = 0;
  const wrapped = new Proxy(vault, {
    get(target, property) {
      if (property === 'noteRead') {
        return async (id: string): Promise<PluginNote | null> => {
          calls += 1;
          active += 1;
          peak = Math.max(peak, active);
          await tick();
          active -= 1;
          return target.noteRead(id);
        };
      }
      if (withBatch && property === 'notesReadBatch') {
        return async (ids: readonly string[]): Promise<readonly (PluginNote | null)[]> => {
          batchCalls += 1;
          return Promise.all(ids.map((id) => target.noteRead(id)));
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  return { vault: wrapped, peak: () => peak, calls: () => calls, batchCalls: () => batchCalls };
}

describe('createReadGate', () => {
  it('no deja más de N tareas a la vez y atiende las que esperan en FIFO', async () => {
    const gate = createReadGate(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (id: number): Promise<number> =>
      gate(async () => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(id);
        await tick();
        active -= 1;
        return id * 10;
      });
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(task));
    expect(results).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
    // FIFO: las dos primeras entran ya; cada hueco libre saca la siguiente en orden.
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('un rechazo libera su hueco y se propaga', async () => {
    const gate = createReadGate(1);
    await expect(
      gate(async () => {
        await tick();
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // Tras el fallo, la siguiente tarea corre enseguida (el hueco quedó libre).
    await expect(gate(async () => 'ok')).resolves.toBe('ok');
  });

  it('el mínimo es 1: ejecución secuencial', async () => {
    const gate = createReadGate(0);
    let active = 0;
    let peak = 0;
    const task = (): Promise<void> =>
      gate(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick();
        active -= 1;
      });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });
});

describe('gateVaultNoteReads', () => {
  it('limita las noteRead concurrentes y conserva el resto del vault', async () => {
    const notes = Array.from({ length: 10 }, (_, i) => fakeNote(`n${i}`, ROOT_FOLDER_ID, `# N${i}\n`));
    const base = vaultFromNotes(new Map([[ROOT_FOLDER_ID, notes]]));
    const counter = countingReads(base);
    const gated = gateVaultNoteReads(counter.vault, 3);

    const results = await Promise.all(notes.map((note) => gated.noteRead(note.id)));
    expect(results.map((note) => note?.id)).toEqual(notes.map((note) => note.id));
    // Sin la puerta, las 10 lecturas habrían entrado a la vez.
    expect(counter.peak()).toBe(3);

    // El resto del vault queda intacto (mismos valores, mismo this).
    expect(gated.rootFolderId()).toBe(base.rootFolderId());
    expect(gated.libraryId()).toBe(base.libraryId());
    await expect(gated.notesPage(null, 5, { kind: 'folder', folderId: ROOT_FOLDER_ID })).resolves.toBeDefined();
    await expect(gated.noteSummary(['n0', 'n1'])).resolves.toHaveLength(2);
  });
});

describe('gatePluginApiNoteReads', () => {
  it('envuelve solo el vault del api: noteRead limitada, el resto tal cual', async () => {
    const notes = Array.from({ length: 6 }, (_, i) => fakeNote(`n${i}`, ROOT_FOLDER_ID, `# N${i}\n`));
    const base = vaultFromNotes(new Map([[ROOT_FOLDER_ID, notes]]));
    const counter = countingReads(base);
    const { api } = await createJdexTestApi({ vault: counter.vault });

    const gated = gatePluginApiNoteReads(api, 2);
    const results = await Promise.all(notes.map((note) => gated.vault.noteRead(note.id)));
    expect(results.map((note) => note?.id)).toEqual(notes.map((note) => note.id));
    expect(counter.peak()).toBe(2);

    expect(gated.apiVersion).toBe(api.apiVersion);
    expect(gated.markdown).toBe(api.markdown);
    expect(gated.workspace).toBe(api.workspace);
    expect(gated.has('vault.read')).toBe(api.has('vault.read'));
    expect(gated.env).toBe(api.env);
  });
});

describe('readNotes — lectura por lotes si el host la tiene', () => {
  it('con notesReadBatch lee en lotes de NOTES_READ_BATCH_MAX y no toca noteRead', async () => {
    const notes = Array.from({ length: 250 }, (_, i) => fakeNote(`n${i}`, ROOT_FOLDER_ID, `# N${i}\n`));
    const base = vaultFromNotes(new Map([[ROOT_FOLDER_ID, notes]]));
    const sizes: number[] = [];
    let readCalls = 0;
    const vault = new Proxy(base, {
      get(target, property) {
        if (property === 'notesReadBatch') {
          return async (ids: readonly string[]): Promise<readonly (PluginNote | null)[]> => {
            sizes.push(ids.length);
            return Promise.all(ids.map((id) => target.noteRead(id)));
          };
        }
        if (property === 'noteRead') {
          return async (id: string): Promise<PluginNote | null> => {
            readCalls += 1;
            return target.noteRead(id);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    const ids = [...notes.map((note) => note.id), 'no-existe'];
    const out = await readNotes(vault, ids);
    expect(sizes).toEqual([NOTES_READ_BATCH_MAX, 51]);
    expect(readCalls).toBe(0);
    expect(out.size).toBe(251);
    expect(out.get('n7')?.title).toBe('N7');
    expect(out.get('no-existe')).toBeNull();
  });

  it('sin notesReadBatch cae a noteRead pasando por la puerta de concurrencia', async () => {
    const notes = Array.from({ length: 10 }, (_, i) => fakeNote(`n${i}`, ROOT_FOLDER_ID, `# N${i}\n`));
    const base = vaultFromNotes(new Map([[ROOT_FOLDER_ID, notes]]));
    const counter = countingReads(base);
    const gated = gateVaultNoteReads(counter.vault, 3);
    const out = await readNotes(gated, notes.map((note) => note.id));
    expect(out.size).toBe(10);
    expect(out.get('n3')?.title).toBe('N3');
    expect(counter.peak()).toBeLessThanOrEqual(3);
  });
});

describe('activateJdex — la puerta arropa las ráfagas de lecturas', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // La misma forma del sistema que usan los tests del runtime: `00-09/00/00.00 JDex` y
  // `20-29/21`, con 8 notas JDex cuyo frontmatter falta `area`/`categoria` (hallazgo que
  // «normalizar» reescribe en lote).
  function buildEightNoteFixture() {
    const sistemaArea = fakeFolder('f-area', ROOT_FOLDER_ID, '00-09 Sistema');
    const sistemaCat = fakeFolder('f-cat', sistemaArea.id, '00 Sistema');
    const jdexId = fakeFolder('f-jdex', sistemaCat.id, '00.00 JDex');
    const productosArea = fakeFolder('f-pa', ROOT_FOLDER_ID, '20-29 Productos y servicios');
    const productosCat = fakeFolder('f-pc', productosArea.id, '21 Productos de software propios');
    const folders: PluginFolder[] = [sistemaArea, sistemaCat, jdexId, productosArea, productosCat];
    const notes = Array.from({ length: 8 }, (_, i) =>
      fakeNote(
        `n-${i + 1}`,
        jdexId.id,
        ['---', `jd: "21.${11 + i}"`, 'tipo: id', '---', `# 21.${11 + i} Nota ${i + 1}`, ''].join('\n')
      )
    );
    const base = vaultFromNotes(new Map([[jdexId.id, notes]]), folders);
    return { base, jdexId };
  }

  async function runNormalizeAll(base: PluginVault, counterVault: PluginVault, withBatchCapability = false) {
    const { api, fake } = await createJdexTestApi({
      vault: counterVault,
      ...(withBatchCapability ? { capabilities: ['vault.read', 'vault.write', 'editor', 'vault.read.batch'] as const } : {})
    });
    await activateJdex(api);
    const command = fake.recorded.commands.find((c) => c.id === JDEX_COMMAND_NORMALIZE_ALL);
    expect(command).toBeTruthy();
    void command!.run();
    const dialog = document.body.querySelector('dialog.hebra-module-modal')!;
    expect(dialog).toBeTruthy();
    const apply = dialog.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    apply.click();
    await vi.waitFor(async () => {
      const note = await base.noteRead('n-1');
      expect(note?.body).toContain('categoria:');
    });
  }

  it('un lote de reescritura no mete en la cola más de MAX_CONCURRENT_NOTE_READS lecturas a la vez', async () => {
    const { base } = buildEightNoteFixture();
    const counter = countingReads(base);
    await runNormalizeAll(base, counter.vault);

    // La reescritura en lote del diario leyó las 8 notas con un Promise.all: con la puerta,
    // nunca entraron en la cola nativa más de 4 a la vez (sin ella, el pico habría sido 8).
    expect(counter.peak()).toBeGreaterThan(1);
    expect(counter.peak()).toBeLessThanOrEqual(MAX_CONCURRENT_NOTE_READS);
    expect(counter.batchCalls()).toBe(0); // sin la capacidad batch no se usa
  });

  it('con la capacidad vault.read.batch del host, el lote se lee en operaciones batch', async () => {
    const { base } = buildEightNoteFixture();
    const counter = countingReads(base, true);
    await runNormalizeAll(base, counter.vault, true);

    // El diario leyó las 8 notas del lote con notesReadBatch (una operación de la cola),
    // no con 8 noteRead sueltas.
    expect(counter.batchCalls()).toBeGreaterThan(0);
    expect(counter.peak()).toBeLessThanOrEqual(MAX_CONCURRENT_NOTE_READS);
  });
});

describe('gatePluginApiNoteReads + readNotes con el host falso de hebra-plugin-api/v2/testing', () => {
  /** Host falso con N notas; cuenta las llamadas a `notesReadBatch` y a `noteRead` del vault. */
  function hostWith(count: number, capabilities: readonly PluginCapability[]): {
    api: HebraPluginApi;
    ids: string[];
    batchSizes: number[];
    individual: () => number;
  } {
    const seeds = Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, `# N${i}\n`]));
    const fake = createFakePluginApiV2({ capabilities, notes: seeds });
    const batchSizes: number[] = [];
    let individual = 0;
    const real = fake.api.vault;
    // La fachada del host está congelada: se envuelve en un objeto nuevo, no en un Proxy suyo.
    const vault: PluginVault = {
      ...real,
      notesReadBatch: (ids) => {
        batchSizes.push(ids.length);
        return real.notesReadBatch!(ids);
      },
      noteRead: (id) => {
        individual += 1;
        return real.noteRead(id);
      }
    };
    const api: HebraPluginApi = { ...fake.api, vault };
    return { api, ids: Object.keys(seeds), batchSizes, individual: () => individual };
  }

  it('con vault.read.batch, N notas son ceil(N/200) llamadas a notesReadBatch y 0 a noteRead', async () => {
    const { api, ids, batchSizes, individual } = hostWith(450, ['vault.read', 'vault.read.batch']);
    expect(api.has('vault.read.batch')).toBe(true);
    const out = await readNotes(gatePluginApiNoteReads(api).vault, [...ids, 'no-existe']);
    expect(batchSizes).toHaveLength(Math.ceil(451 / NOTES_READ_BATCH_MAX));
    expect(batchSizes).toEqual([200, 200, 51]);
    expect(individual()).toBe(0);
    expect([...out.keys()]).toEqual([...ids, 'no-existe']);
    expect(out.get('n449')?.id).toBe('n449');
    expect(out.get('no-existe')).toBeNull();
  });

  it('sin la capacidad vuelve a noteRead una a una y no llama a notesReadBatch', async () => {
    const { api, ids, batchSizes, individual } = hostWith(30, ['vault.read']);
    expect(api.has('vault.read.batch')).toBe(false);
    const out = await readNotes(gatePluginApiNoteReads(api).vault, ids);
    expect(batchSizes).toEqual([]);
    expect(individual()).toBe(30);
    expect(out.size).toBe(30);
  });
});
