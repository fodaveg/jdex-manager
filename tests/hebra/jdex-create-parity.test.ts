import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  buildIndex,
  DEFAULT_SETTINGS,
  loadLibraryState,
  planNewId,
  resolveSettings,
  type EnsureResult,
  type JdexManagerSettings,
  type LibraryPort,
  type PortFolder,
  type PortNote
} from '../../src/hebra/engine';
import { createJdexId } from '../../src/hebra/jdex-create-write';
import { HebraLibraryPort, jdexLibraryState } from '../../src/hebra/library-port-adapter';
import { buildJdexIndexInput, walkJdexLibrary } from '../../src/hebra/library-index';
import { FakeJdexVault } from './support/fakes';

const markdown = createFakePluginApiV2().api.markdown;
const JDEX = '00-09 Sistema/00 Gestión/00.00 JDex';
const TEMPLATES = '00-09 Sistema/00 Gestión/00.03 Plantillas';

/** Same engine-level port over plain arrays, seeded with the vault's own ids. */
class MemoryPort implements LibraryPort {
  constructor(public folders: PortFolder[], public notes: (PortNote & { folderId: string; body: string })[]) {}
  async listFolders() { return this.folders; }
  async listNotes(folderId: string) { return this.notes.filter((n) => n.folderId === folderId).map(({ id, title }) => ({ id, title })); }
  async readNote(id: string) { return { body: this.notes.find((n) => n.id === id)!.body }; }
  async ensureFolder(parentId: string | null, name: string): Promise<EnsureResult> {
    const found = this.folders.find((f) => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase());
    if (found) return { id: found.id, created: false };
    const id = `m-f${this.folders.length}`;
    this.folders.push({ id, parentId, name });
    return { id, created: true };
  }
  async ensureNote(folderId: string, title: string, body: string): Promise<EnsureResult> {
    const found = this.notes.find((n) => n.folderId === folderId && n.title === title);
    if (found) return { id: found.id, created: false };
    const id = `m-n${this.notes.length}`;
    this.notes.push({ id, title, folderId, body });
    return { id, created: true };
  }
  async hasHidden() { return false; }
}

async function seedVault(): Promise<FakeJdexVault> {
  const vault = new FakeJdexVault();
  const folder = (id: string, parentId: string | null, name: string) => vault.seedFolder({ id, parentId, name, createdAt: 0, updatedAt: 0 });
  const note = async (folderId: string, title: string, body = `# ${title}\n`) => { await vault.noteCreate({ folderId, body: markdown.withTitle(body, title) }); };
  folder('a00', null, '00-09 Sistema');
  folder('c00', 'a00', '00 Gestión');
  folder('jdex', 'c00', '00.00 JDex');
  folder('tpl', 'c00', '00.03 Plantillas');
  folder('a20', null, '20-29 Productos');
  folder('c21', 'a20', '21 Productos de software');
  folder('i2111', 'c21', '21.11 Hebra');
  folder('c23', 'a20', '23 Otros');
  await note('jdex', '20-29 Productos');
  await note('jdex', '21 Productos de software');
  await note('jdex', '23 Otros');
  await note('jdex', '21.11 Hebra');
  // Two notes with the same title: the plugin tells them apart with a tie-break suffix.
  await note('jdex', '21.12 Repetida');
  await note('jdex', '21.12 Repetida');
  await note('tpl', 'JDex - id', '---\njd: "{{id}}"\ntipo: id\n---\nPlantilla propia de {{title}} en {{categoryTitle}}\n');
  return vault;
}

const settings: JdexManagerSettings = {
  ...DEFAULT_SETTINGS,
  jdexFolder: JDEX,
  templatesFolder: TEMPLATES,
  subfolderPatternsByCategory: { '21': '40 Audits\n70 Adjuntos/Imágenes' }
};

describe('Crear ID: el plugin (con el adaptador) y el motor en memoria dan el mismo plan', () => {
  it('mismo plan para el mismo árbol, con plantilla propia, patrón y notas repetidas', async () => {
    const vault = await seedVault();
    const folders = (await vault.foldersList()).filter((f) => f.id !== vault.rootFolderId());
    const walk = await walkJdexLibrary(vault, folders, '', vault.rootFolderId(), undefined, JDEX);
    const index = buildIndex(buildJdexIndexInput(walk, settings));
    const jdexId = walk.folderIdByPath!.get(JDEX)!;
    const portA = new HebraLibraryPort(vault, markdown);
    const request = { category: '21', title: 'Nuevo módulo', createPattern: true, skipMissingCategoryFolder: true };
    const fromPlugin = await planNewId(portA, jdexLibraryState(walk, index, settings, jdexId), request);

    const memory = new MemoryPort(
      folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
      await Promise.all(walk.systemNotes.map(async (ref) => ({ id: ref.id, title: ref.title, folderId: ref.folderId, body: (await vault.noteRead(ref.id))!.body ?? '' })))
    );
    const resolved = await resolveSettings(memory, { settings });
    if (!resolved.ok) throw new Error(resolved.code);
    const fromEngine = await planNewId(memory, await loadLibraryState(memory, resolved.value), request);

    expect(fromPlugin.ok).toBe(true);
    expect(fromPlugin).toEqual(fromEngine);
    const plan = fromPlugin.ok ? fromPlugin.value : null!;
    expect(plan.id).toBe('21.13');
    expect(plan.template.source).toBe('templates-folder');
    expect(plan.writes.map((w) => w.kind)).toEqual(['ensure_note', 'ensure_folder', 'ensure_folder', 'ensure_folder', 'ensure_folder']);
  });

  it('createJdexId escribe lo que el plan dice, con title: por withTitle, y devuelve la misma salida de siempre', async () => {
    const vault = await seedVault();
    const folders = (await vault.foldersList()).filter((f) => f.id !== vault.rootFolderId());
    const walk = await walkJdexLibrary(vault, folders, '', vault.rootFolderId(), undefined, JDEX);
    const index = buildIndex(buildJdexIndexInput(walk, settings));
    const category = index.categories.find((c) => c.number === '21')!;
    const outcome = await createJdexId(vault, markdown, walk, settings, index, { category, id: '21.13', title: 'Nuevo módulo', createFolder: true, createPattern: true });
    expect(outcome.note.title).toBe('21.13 Nuevo módulo');
    expect(outcome.note.body).toMatch(/^title: "?21\.13 Nuevo módulo"?$/m);
    expect(outcome.note.body).toContain('Plantilla propia de Nuevo módulo en 21 Productos de software');
    expect(outcome.folderPath).toBe('20-29 Productos/21 Productos de software/21.13 Nuevo módulo');
    expect(outcome.folderNotice).toBeNull();
    const after = await vault.foldersList();
    const idFolder = after.find((f) => f.name === '21.13 Nuevo módulo')!;
    expect(idFolder.parentId).toBe('c21');
    const adjuntos = after.find((f) => f.parentId === idFolder.id && f.name === '70 Adjuntos')!;
    expect(after.some((f) => f.parentId === adjuntos.id && f.name === 'Imágenes')).toBe(true);
  });

  it('applyPlan por el adaptador no duplica en un reintento', async () => {
    const vault = await seedVault();
    const port = new HebraLibraryPort(vault, markdown);
    const resolved = await resolveSettings(port, { settings });
    if (!resolved.ok) throw new Error(resolved.code);
    const planned = await planNewId(port, await loadLibraryState(port, resolved.value), { category: '21', title: 'Otra' });
    if (!planned.ok) throw new Error(planned.code);
    await applyPlan(port, planned.value);
    const again = await applyPlan(port, planned.value);
    expect(again.ok && again.value.created).toEqual([]);
    expect((await vault.foldersList()).filter((f) => f.name === '21.13 Otra')).toHaveLength(1);
  });

  it('una nota protegida de la carpeta JDex sigue contando como ocupada y hasHidden es false', async () => {
    const vault = await seedVault();
    const port = new HebraLibraryPort(vault, markdown);
    expect(await port.hasHidden()).toBe(false);
    expect((await port.listFolders()).every((f) => f.id !== vault.rootFolderId())).toBe(true);
  });
});
