import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { buildIndex, DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { applyJdexRepair } from '../../src/hebra/jdex-repair';
import { FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';

const jdex = '00.00 JDex';
const area = '20-29 Productos';
const category = `${area}/21 Software`;
const inbox = `${category}/21.01 Inbox`;
const id = `${category}/21.22 Proyecto`;

function setup(notePaths: string[] = []) {
  const vault = new FakeJdexVault();
  const folders = [
    fakeFolder('jdex', vault.rootFolderId(), jdex),
    fakeFolder('area', vault.rootFolderId(), area),
    fakeFolder('category', 'area', '21 Software'),
    fakeFolder('inbox', 'category', '21.01 Inbox'),
    fakeFolder('id', 'category', '21.22 Proyecto')
  ];
  folders.forEach((folder) => vault.seedFolder(folder));
  const folderPaths = new Map([['jdex', jdex], ['area', area], ['category', category], ['inbox', inbox], ['id', id]]);
  const walk: JdexLibraryWalk = { rootFolderId: vault.rootFolderId(), folderPaths, systemFolderPaths: [...folderPaths.values()], systemNotes: [] };
  const index = buildIndex({ systemRoot: '', jdexFolder: jdex, folderPaths: [...folderPaths.values()], notePaths });
  const settings = { ...DEFAULT_SETTINGS, jdexFolder: jdex, systemRoot: '' };
  const markdown = createFakePluginApi().api.markdown;
  return { vault, walk, index, settings, markdown };
}

describe('Hebra unified repair executor', () => {
  it('creates the missing JDex note using the ID template and refuses a live title collision', async () => {
    const state = setup();
    const fix = { type: 'create-note', path: `${jdex}/21.22 Proyecto.md`, number: '21.22', title: 'Proyecto', kind: 'id', category: '21' } as const;
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, fix);
    const page = await state.vault.notesPage(null, 200, { kind: 'folder', folderId: 'jdex' });
    expect(page.items.map((note) => note.title)).toEqual(['21.22 Proyecto']);
    const created = await state.vault.noteRead(page.items[0].id);
    expect(created?.body).toContain('jd: "21.22"');
    await expect(applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, fix)).rejects.toThrow('ya existe');
  });

  it('creates pattern folders, renames the ID folder, moves content to inbox and trashes only identical conflict copies', async () => {
    const state = setup();
    const inner = `${id}/40 Audits`;
    await applyJdexRepair(state.vault, state.markdown, state.walk, state.index, state.settings, { type: 'create-folder', path: inner, paths: [inner] });
    expect((await state.vault.foldersList()).some((folder) => folder.name === '40 Audits')).toBe(true);
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
  });
});
