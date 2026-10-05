import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildIndex, DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { applyJdexRepair } from '../../src/hebra/jdex-repair';
import { FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';

const jdex = '00.00 JDex';
const area = '20-29 Productos';
const category = `${area}/21 Software`;
const inbox = `${category}/21.01 Inbox`;
const id = `${category}/21.22 Proyecto`;
const dCategory = 'D01.20-29 Productos/D01.21 Software';
const dId = `${dCategory}/D01.21.22 Proyecto`;

function setup(notePaths: string[] = []) {
  const vault = new FakeJdexVault();
  const folders = [
    fakeFolder('jdex', vault.rootFolderId(), jdex),
    fakeFolder('area', vault.rootFolderId(), area),
    fakeFolder('category', 'area', '21 Software'),
    fakeFolder('inbox', 'category', '21.01 Inbox'),
    fakeFolder('id', 'category', '21.22 Proyecto'),
    fakeFolder('d-area', vault.rootFolderId(), 'D01.20-29 Productos'),
    fakeFolder('d-category', 'd-area', 'D01.21 Software'),
    fakeFolder('d-id', 'd-category', 'D01.21.22 Proyecto'),
    fakeFolder('d-child', 'd-id', '+ Hijo')
  ];
  folders.forEach((folder) => vault.seedFolder(folder));
  const folderPaths = new Map([['jdex', jdex], ['area', area], ['category', category], ['inbox', inbox], ['id', id],
    ['d-area', 'D01.20-29 Productos'], ['d-category', dCategory], ['d-id', dId], ['d-child', `${dId}/+ Hijo`]]);
  const walk: JdexLibraryWalk = { rootFolderId: vault.rootFolderId(), folderPaths, systemFolderPaths: [...folderPaths.values()], systemNotes: [] };
  const index = buildIndex({ systemRoot: '', jdexFolder: jdex, folderPaths: [...folderPaths.values()], notePaths });
  const settings = { ...DEFAULT_SETTINGS, jdexFolder: jdex, systemRoot: '' };
  const markdown = createFakePluginApi().api.markdown;
  return { vault, walk, index, settings, markdown };
}

describe('Hebra unified repair executor', () => {
  it('preserves a concurrent folder rename instead of applying the stale repair', async () => {
    const state = setup();
    const renameIfUnchanged = state.vault.folderRenameIfUnchanged.bind(state.vault);
    vi.spyOn(state.vault, 'folderRenameIfUnchanged').mockImplementation(async (folderId, name, expected) => {
      await state.vault.folderRename(folderId, '21.22 Edición manual');
      return renameIfUnchanged(folderId, name, expected);
    });
    await expect(applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings,
      { type: 'rename', from: id, to: `${category}/21.22 Propuesto` })).rejects.toThrow('cambió mientras se renombraba');
    expect((await state.vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.22 Edición manual');
  });

  it('preserves a note moved concurrently instead of applying its stale destination', async () => {
    const state = setup();
    state.vault.seedNote(fakeNote('content', 'id', '# Contenido'));
    const from = `${id}/Contenido.md`;
    const walk = { ...state.walk, systemNotes: [{ id: 'content', folderId: 'id', title: 'Contenido', path: from }] };
    const moveIfUnchanged = state.vault.noteMoveIfUnchanged.bind(state.vault);
    vi.spyOn(state.vault, 'noteMoveIfUnchanged').mockImplementation(async (noteId, folderId, expected) => {
      await state.vault.noteMove(noteId, 'inbox');
      return moveIfUnchanged(noteId, folderId, expected);
    });
    await expect(applyJdexRepair(state.vault, state.markdown, walk, state.index, state.settings,
      { type: 'move', items: [{ from, to: `${category}/Contenido.md` }] })).rejects.toThrow('cambió mientras se movía');
    expect((await state.vault.noteRead('content'))?.folderId).toBe('inbox');
  });

  it('creates opted-in structure notes from their own templates and keeps system scopes separate', async () => {
    const state = setup();
    const areaFix = { type: 'create-note', path: `${jdex}/D01.20-29 Productos.md`, number: '20-29', system: 'D01', title: 'Productos', kind: 'area', category: '' } as const;
    await expect(applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, areaFix)).rejects.toThrow('Activa');
    const settings = { ...state.settings, structureNotesAreFindings: true };
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, settings, areaFix);
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, settings,
      { type: 'create-note', path: `${jdex}/D01.21 Software.md`, number: '21', system: 'D01', title: 'Software', kind: 'categoria', category: '21' });
    const page = await state.vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' });
    expect(page.items.map((note) => note.title)).toEqual(['D01.20-29 Productos', 'D01.21 Software']);
    expect((await state.vault.noteRead(page.items[0].id))?.body).toContain('tipo: area');
    expect((await state.vault.noteRead(page.items[1].id))?.body).toContain('tipo: categoria');
    expect((await state.vault.noteRead(page.items[1].id))?.body).toContain('area: "D01.20-29 Productos"');
    await expect(applyJdexRepair(state.vault, state.markdown, state.walk, state.index, settings,
      { ...areaFix, path: `${jdex}/D02.20-29 Productos.md`, system: 'D02' })).rejects.toThrow('falta su categoría o área');
  });

  it('creates the missing JDex note using the ID template and refuses a live title collision', async () => {
    const state = setup();
    const fix = { type: 'create-note', path: `${jdex}/21.22 Proyecto.md`, number: '21.22', title: 'Proyecto', kind: 'id', category: '21' } as const;
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, fix);
    const page = await state.vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' });
    expect(page.items.map((note) => note.title)).toEqual(['21.22 Proyecto']);
    const created = await state.vault.noteRead(page.items[0].id);
    expect(created?.body).toContain('jd: "21.22"');
    await expect(applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, fix)).rejects.toThrow('ya existe');
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings,
      { ...fix, path: `${jdex}/D01.21.22 Proyecto.md`, system: 'D01' });
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings,
      { ...fix, path: `${jdex}/D01.21.22+ Hijo.md`, number: '21.22+', title: 'Hijo', system: 'D01' });
    const prefixed = await state.vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' });
    expect(prefixed.items.map((note) => note.title)).toEqual(['21.22 Proyecto', 'D01.21.22 Proyecto', 'D01.21.22+ Hijo']);
    expect((await state.vault.noteRead(prefixed.items[1].id))?.body).toContain('categoria: "D01.21 Software"');
  });

  it('creates pattern folders, renames the ID folder, moves content to inbox and trashes only identical conflict copies', async () => {
    const state = setup();
    const inner = `${id}/40 Audits`;
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, { type: 'create-folder', path: inner, paths: [inner] });
    expect((await state.vault.foldersList()).some((folder) => folder.name === '40 Audits')).toBe(true);
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, { type: 'folders', paths: [`${id}/70 Adjuntos`] });
    expect((await state.vault.foldersList()).some((folder) => folder.name === '70 Adjuntos')).toBe(true);
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, { type: 'rename', from: id, to: `${category}/21.22 Nuevo` });
    expect((await state.vault.foldersList()).find((folder) => folder.id === 'id')?.name).toBe('21.22 Nuevo');

    const body = '# 21.23 Copia\nMismo cuerpo';
    state.vault.seedNote(fakeNote('original', 'id', body));
    state.vault.seedNote(fakeNote('copy', 'id', body));
    const from = `${category}/21.22 Nuevo/21.23 Copia.md`;
    const walk: JdexLibraryWalk = { ...state.walk, systemNotes: [{ id: 'original', folderId: 'id', title: '21.23 Copia', path: from },
      { id: 'copy', folderId: 'id', title: '21.23 Copia', path: `${category}/21.22 Nuevo/21.23 Copia (conflicted copy).md` }] };
    await applyJdexRepair(state.vault, state.markdown, walk, state.index, state.settings,
      { type: 'move', items: [{ from, to: `${inbox}/21.23 Copia.md` }] });
    expect((await state.vault.noteRead('original'))?.folderId).toBe('inbox');
    await applyJdexRepair(state.vault, state.markdown, walk, state.index, state.settings,
      { type: 'trash', path: walk.systemNotes[1].path, identicalTo: from });
    expect((await state.vault.noteRead('copy'))?.trashedAt).not.toBeNull();
    state.vault.setTrashed('copy', false);
    state.vault.saveElsewhere('copy', '# 21.23 Copia\nCuerpo distinto');
    await expect(applyJdexRepair(state.vault, state.markdown, walk, state.index, state.settings,
      { type: 'trash', path: walk.systemNotes[1].path, identicalTo: from })).rejects.toThrow('no es idéntica');
    state.vault.saveElsewhere('copy', body);
    const trashIfUnchanged = state.vault.noteTrashIfUnchanged.bind(state.vault);
    vi.spyOn(state.vault, 'noteTrashIfUnchanged').mockImplementation(async (noteId, expected) => {
      state.vault.saveElsewhere(noteId, `${body}\nCambio concurrente`);
      return trashIfUnchanged(noteId, expected);
    });
    await expect(applyJdexRepair(state.vault, state.markdown, walk, state.index, state.settings,
      { type: 'trash', path: walk.systemNotes[1].path, identicalTo: from })).rejects.toThrow('cambió mientras');
    expect((await state.vault.noteRead('copy'))?.trashedAt).toBeNull();
    expect((await state.vault.noteRead('copy'))?.body).toContain('Cambio concurrente');
  });
});
