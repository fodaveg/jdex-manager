/**
 * «Mover la nota abierta aquí» en Hebra pasa por el motor compartido (`planMoveIntoId` y
 * `applyMovePlan`) con `HebraMovePort` sobre la API de plugins: crea la carpeta del ID si
 * falta, rechaza un nombre ocupado y da el mismo plan que el motor sobre un puerto en memoria.
 */
import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import type { PluginVault } from 'hebra-plugin-api/v2';
import { describe, expect, it, vi } from 'vitest';
import {
  buildIndex,
  DEFAULT_SETTINGS,
  loadLibraryState,
  planMoveIntoId,
  resolveSettings,
  type EnsureResult,
  type IdEntry,
  type JdexManagerSettings,
  type LibraryMovePort,
  type PortFolder,
  type PortNote
} from '../../src/hebra/engine';
import { moveJdexNoteToEntry, type JdexActionPorts } from '../../src/hebra/jdex-actions';
import { HebraMovePort, jdexLibraryState } from '../../src/hebra/library-port-adapter';
import { buildJdexIndexInput, walkJdexLibrary } from '../../src/hebra/library-index';
import { fakeFolder, fakeNote, FakeJdexVault } from './support/fakes';

const markdown = createFakePluginApiV2().api.markdown;
const settings: JdexManagerSettings = { ...DEFAULT_SETTINGS, jdexFolder: 'JDex', templatesFolder: '', dateOnMove: true };

/** Un sistema pequeño: 21.11 con carpeta, 21.12 sin ella, y una carpeta suelta con la nota. */
function seed(): FakeJdexVault {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('jdex', null, 'JDex'),
    fakeFolder('loose', null, 'Sueltas'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id11', 'cat', '21.11 Algo')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('jn-11', 'jdex', '# 21.11 Algo\n'));
  vault.seedNote(fakeNote('jn-12', 'jdex', '# 21.12 Otro\n'));
  vault.seedNote(fakeNote('active', 'loose', '# Informe\n'));
  return vault;
}

async function context(vault: FakeJdexVault) {
  const folders = (await vault.foldersList()).filter((f) => f.id !== vault.rootFolderId());
  const walk = await walkJdexLibrary(vault, folders, '', vault.rootFolderId(), undefined, 'JDex');
  const index = buildIndex(buildJdexIndexInput(walk, settings));
  const entry = (id: string): IdEntry => index.ids.find((e) => e.id === id)!;
  return { walk, index, folders, entry };
}

function actionPorts(vault: PluginVault) {
  const notice = vi.fn<(text: string) => void>();
  const rebuild = vi.fn(async () => {});
  const run = vi.fn((_kind: string, _label: string, action: (v: PluginVault) => Promise<unknown>) => action(vault));
  return { value: { notice, rebuild, journal: { run } } as unknown as JdexActionPorts, notice, rebuild, run };
}

async function move(vault: FakeJdexVault, toId: string) {
  const { walk, index, entry } = await context(vault);
  const ports = actionPorts(vault);
  const note = vault.peek('active');
  await moveJdexNoteToEntry(ports.value, { id: note.id, folderId: note.folderId, title: note.title }, entry(toId), walk, { index, settings, library: vault, markdown });
  return ports;
}

describe('Mover la nota abierta a un ID (motor compartido)', () => {
  it('la mueve a la carpeta del ID, avisa y refresca', async () => {
    const vault = seed();
    const { notice, rebuild, run } = await move(vault, '21.11');
    expect(run).toHaveBeenCalledWith('move', 'Mover nota a 21.11 Algo', expect.any(Function));
    expect(vault.peek('active').folderId).toBe('id11');
    expect(notice).toHaveBeenCalledWith('Movida a 21.11 Algo.');
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('si el ID no tiene carpeta, la crea bajo su categoría y mueve la nota', async () => {
    const vault = seed();
    const { notice } = await move(vault, '21.12');
    const created = (await vault.foldersList()).find((f) => f.name === '21.12 Otro');
    expect(created?.parentId).toBe('cat');
    expect(vault.peek('active').folderId).toBe(created!.id);
    expect(notice).toHaveBeenCalledWith('Movida a 21.12 Otro.');
  });

  it('si en el destino ya hay algo con ese nombre, rechaza sin mover ni abrir el diario', async () => {
    const vault = seed();
    vault.seedNote(fakeNote('twin', 'id11', '# Informe\n'));
    const { notice, run, rebuild } = await move(vault, '21.11');
    expect(vault.peek('active').folderId).toBe('loose');
    expect(notice).toHaveBeenCalledWith('En el destino ya hay algo llamado «Informe».');
    expect(run).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('no fecha el nombre aunque el ajuste dateOnMove esté activo: el título se conserva', async () => {
    const vault = seed();
    await move(vault, '21.11');
    expect(vault.peek('active').title).toBe('Informe');
  });

  it('una nota que ha desaparecido da un aviso y no mueve nada', async () => {
    const vault = seed();
    const { walk, index, entry } = await context(vault);
    const ports = actionPorts(vault);
    await moveJdexNoteToEntry(ports.value, { id: 'ghost', folderId: 'loose' }, entry('21.11'), walk, { index, settings, library: vault, markdown });
    expect(ports.notice).toHaveBeenCalledWith('No se encuentra lo que hay que mover.');
    expect(ports.run).not.toHaveBeenCalled();
  });
});

/** El puerto del motor sobre arrays, con los mismos ids que la biblioteca. */
class MemoryMovePort implements LibraryMovePort {
  constructor(public folders: PortFolder[], public notes: (PortNote & { folderId: string })[]) {}
  async listFolders() { return this.folders; }
  async listNotes(folderId: string) { return this.notes.filter((n) => n.folderId === folderId).map(({ id, title }) => ({ id, title })); }
  async readNote() { return { body: '' }; }
  async ensureFolder(parentId: string | null, name: string): Promise<EnsureResult> {
    const found = this.folders.find((f) => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase());
    if (found) return { id: found.id, created: false };
    const id = `m-f${this.folders.length}`;
    this.folders.push({ id, parentId, name });
    return { id, created: true };
  }
  async ensureNote(): Promise<EnsureResult> { throw new Error('no se usa'); }
  async hasHidden() { return false; }
  async listFiles() { return []; }
  async hiddenInside() { return false; }
  async moveNote() { return { ok: true }; }
  async moveFile() { return { ok: true }; }
  async moveFolder() { return { ok: true }; }
}

describe('Mover a un ID: el plugin (con el adaptador) y el motor en memoria dan el mismo plan', () => {
  it.each([
    ['con carpeta', '21.11'],
    ['sin carpeta', '21.12']
  ])('mismo plan para el mismo árbol y la misma petición, ID %s', async (_name, toId) => {
    const vault = seed();
    vault.seedNote(fakeNote('twin', 'loose', '# Otra\n'));
    const { walk, index, folders } = await context(vault);
    const request = { source: { kind: 'note' as const, id: 'active', folderId: 'loose' }, toId };
    const fromPlugin = await planMoveIntoId(new HebraMovePort(vault, markdown), jdexLibraryState(walk, index, settings, walk.folderIdByPath!.get('JDex')!), request);

    const memory = new MemoryMovePort(
      folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
      walk.systemNotes.map((ref) => ({ id: ref.id, title: ref.title, folderId: ref.folderId }))
    );
    memory.notes.push({ id: 'active', title: 'Informe', folderId: 'loose' }, { id: 'twin', title: 'Otra', folderId: 'loose' });
    const resolved = await resolveSettings(memory, { settings });
    if (!resolved.ok) throw new Error(resolved.code);
    const fromEngine = await planMoveIntoId(memory, await loadLibraryState(memory, resolved.value), request);

    expect(fromPlugin.ok).toBe(true);
    expect(fromPlugin).toEqual(fromEngine);
    const plan = fromPlugin.ok ? fromPlugin.value : null!;
    expect(plan.writes.length).toBe(toId === '21.12' ? 1 : 0);
  });
});
