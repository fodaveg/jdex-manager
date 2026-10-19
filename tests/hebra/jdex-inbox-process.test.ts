import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import type { PluginVault } from 'hebra-plugin-api/v2';
import {
  applyMovePlan,
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
import {
  archiveJdexInboxNote,
  jdexInboxArchiveTarget,
  jdexInboxQueue,
  jdexZeroTarget,
  moveJdexInboxNote,
  trashJdexInboxNote
} from '../../src/hebra/jdex-inbox-process';
import { buildJdexIndexInput, walkJdexLibrary, type JdexInboxSummary, JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const markdown = createFakePluginApiV2().api.markdown;

function note(id: string, folderId: string, title: string): JdexNoteRef {
  return { id, folderId, title, path: `${title}.md` };
}

describe('jdexInboxQueue', () => {
  it('las notas directas de cada carpeta .01 del resumen, ninguna otra', () => {
    const summary: JdexInboxSummary = {
      folders: [
        {
          entry: { id: '00.01', category: '00', title: 'Bandeja', label: '00.01 Bandeja' },
          path: '00.01 Bandeja',
          folderId: 'f-inbox',
          count: 1
        }
      ],
      total: 1
    };
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map(),
      systemFolderPaths: [],
      systemNotes: [note('n1', 'f-inbox', 'Suelta'), note('n2', 'f-otra', 'De otra carpeta')]
    };
    expect(jdexInboxQueue(summary, walk).map((n) => n.id)).toEqual(['n1']);
  });
});

/** Un sistema pequeño: 21.11 con carpeta, 21.12 sin ella, y la nota suelta en el inbox. */
function moveSeed(): FakeJdexVault {
  const vault = new FakeJdexVault();
  for (const folder of [
    fakeFolder('jdex', null, 'JDex'),
    fakeFolder('inbox', null, 'Inbox'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('id11', 'cat', '21.11 Algo')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('jn-11', 'jdex', '# 21.11 Algo\n'));
  vault.seedNote(fakeNote('jn-12', 'jdex', '# 21.12 Otro\n'));
  vault.seedNote(fakeNote('n1', 'inbox', '# Informe\n'));
  return vault;
}

const moveSettings: JdexManagerSettings = { ...DEFAULT_SETTINGS, jdexFolder: 'JDex', templatesFolder: '', dateOnMove: true };

async function moveContext(vault: FakeJdexVault) {
  const folders = (await vault.foldersList()).filter((f) => f.id !== vault.rootFolderId());
  const walk = await walkJdexLibrary(vault, folders, '', vault.rootFolderId(), undefined, 'JDex');
  const index = buildIndex(buildJdexIndexInput(walk, moveSettings));
  return { walk, index, folders, entry: (id: string): IdEntry => index.ids.find((e) => e.id === id)! };
}

async function moveFromInbox(vault: FakeJdexVault, toId: string, noteRef: JdexNoteRef = note('n1', 'inbox', 'Informe')) {
  const { walk, index, entry } = await moveContext(vault);
  const run = vi.fn((action: (v: PluginVault) => Promise<unknown>) => action(vault));
  const result = moveJdexInboxNote(noteRef, entry(toId), walk, { index, settings: moveSettings, library: vault, markdown, run });
  return { result, run };
}

describe('moveJdexInboxNote (motor compartido)', () => {
  it('mueve la nota a la carpeta del ID dentro del diario', async () => {
    const vault = moveSeed();
    const { result, run } = await moveFromInbox(vault, '21.11');
    await result;
    expect(run).toHaveBeenCalledOnce();
    expect(vault.peek('n1').folderId).toBe('id11');
  });

  it('crea la carpeta del ID que falta bajo su categoría y mueve la nota', async () => {
    const vault = moveSeed();
    const { result } = await moveFromInbox(vault, '21.12');
    await result;
    const created = (await vault.foldersList()).find((f) => f.name === '21.12 Otro');
    expect(created?.parentId).toBe('cat');
    expect(vault.peek('n1').folderId).toBe(created!.id);
  });

  it('con el nombre ocupado en el destino rechaza sin mover ni abrir el diario', async () => {
    const vault = moveSeed();
    vault.seedNote(fakeNote('twin', 'id11', '# Informe\n'));
    const { result, run } = await moveFromInbox(vault, '21.11');
    await expect(result).rejects.toThrow('En el destino ya hay algo llamado «Informe».');
    expect(vault.peek('n1').folderId).toBe('inbox');
    expect(run).not.toHaveBeenCalled();
  });

  it('una nota que ya no está donde se vio se rechaza sin mover nada', async () => {
    const vault = moveSeed();
    vault.seedFolder(fakeFolder('elsewhere', null, 'Otra'));
    await vault.noteMove('n1', 'elsewhere');
    const { result, run } = await moveFromInbox(vault, '21.11');
    await expect(result).rejects.toThrow();
    expect(vault.peek('n1').folderId).toBe('elsewhere');
    expect(run).not.toHaveBeenCalled();
  });

  it('una nota renombrada entre el plan y la escritura se rechaza sin mover', async () => {
    const vault = moveSeed();
    const { walk, index, entry } = await moveContext(vault);
    const run = async (action: (v: PluginVault) => Promise<unknown>) => {
      vault.saveElsewhere('n1', '# Otro título\n');
      return action(vault);
    };
    await expect(moveJdexInboxNote(note('n1', 'inbox', 'Informe'), entry('21.11'), walk, { index, settings: moveSettings, library: vault, markdown, run })).rejects.toThrow();
    expect(vault.peek('n1').folderId).toBe('inbox');
  });

  it('una nota que cambia justo antes de mover se rechaza (noteMoveIfUnchanged devuelve null)', async () => {
    const vault = moveSeed();
    const { walk, index, entry } = await moveContext(vault);
    const guarded = vi.spyOn(vault, 'noteMoveIfUnchanged').mockResolvedValue(null);
    const run = (action: (v: PluginVault) => Promise<unknown>) => action(vault);
    await expect(moveJdexInboxNote(note('n1', 'inbox', 'Informe'), entry('21.11'), walk, { index, settings: moveSettings, library: vault, markdown, run })).rejects.toThrow();
    expect(guarded).toHaveBeenCalledOnce();
    expect(vault.peek('n1').folderId).toBe('inbox');
  });

  it('sin carpeta del JDex avisa y no planifica', async () => {
    const vault = moveSeed();
    const { walk, index, entry } = await moveContext(vault);
    const run = vi.fn();
    await expect(moveJdexInboxNote(note('n1', 'inbox', 'Informe'), entry('21.11'), walk, { index, settings: { ...moveSettings, jdexFolder: 'No existe' }, library: vault, markdown, run })).rejects.toThrow('No se encontró la carpeta del JDex.');
    expect(run).not.toHaveBeenCalled();
  });

  describe('paridad con planMoveIntoId sobre un puerto en memoria', () => {
    class MemoryMovePort implements LibraryMovePort {
      moved: { id: string; folderId: string }[] = [];
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
      async moveNote(id: string, _expected: unknown, to: { folderId: string }) { this.moved.push({ id, folderId: to.folderId }); return { ok: true }; }
      async moveFile() { return { ok: true }; }
      async moveFolder() { return { ok: true }; }
    }

    it.each([
      ['con carpeta', '21.11', false],
      ['sin carpeta', '21.12', false],
      ['nombre ocupado', '21.11', true]
    ])('mismo resultado que el motor, ID %s', async (_name, toId, occupied) => {
      const vault = moveSeed();
      if (occupied) vault.seedNote(fakeNote('twin', 'id11', '# Informe\n'));
      const { walk, folders } = await moveContext(vault);

      const memory = new MemoryMovePort(
        folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
        walk.systemNotes.map((ref) => ({ id: ref.id, title: ref.title, folderId: ref.folderId }))
      );
      memory.notes.push({ id: 'n1', title: 'Informe', folderId: 'inbox' });
      if (occupied) memory.notes.push({ id: 'twin', title: 'Informe', folderId: 'id11' });
      const resolved = await resolveSettings(memory, { settings: moveSettings });
      if (!resolved.ok) throw new Error(resolved.code);
      const planned = await planMoveIntoId(memory, await loadLibraryState(memory, resolved.value), { source: { kind: 'note', id: 'n1', folderId: 'inbox' }, toId });
      if (planned.ok) await applyMovePlan(memory, planned.value);

      const { result } = await moveFromInbox(vault, toId);
      if (planned.ok) {
        await result;
        const target = vault.peek('n1').folderId;
        const targetName = (await vault.foldersList()).find((f) => f.id === target)?.name;
        const memoryTarget = memory.folders.find((f) => f.id === memory.moved[0].folderId)?.name;
        expect(targetName).toBe(memoryTarget);
        expect(planned.value.writes.length).toBe(toId === '21.12' ? 1 : 0);
      } else {
        await expect(result).rejects.toThrow(planned.message);
        expect(memory.moved).toEqual([]);
      }
    });
  });
});

describe('trashJdexInboxNote', () => {
  it('sends the note to the trash when it is unchanged', async () => {
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n1', 'inbox', '# Suelta\n'));
    await trashJdexInboxNote(library, note('n1', 'inbox', 'Suelta'));
    expect((await library.noteRead('n1'))?.trashedAt).not.toBeNull();
  });

  it('does not trash a note that moved or changed since the dialog opened', async () => {
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n1', 'elsewhere', '# Suelta\n'));
    await expect(trashJdexInboxNote(library, note('n1', 'inbox', 'Suelta'))).rejects.toThrow('cambió');
    expect((await library.noteRead('n1'))?.trashedAt).toBeNull();
  });
});

describe('archiveJdexInboxNote', () => {
  function fixture(withArchive = true) {
    const inboxPath = '20-29 Productos/21 Software/21.01 Inbox';
    const archivePath = '20-29 Productos/21 Software/21.09 Archivo';
    const paths = ['20-29 Productos', '20-29 Productos/21 Software', inboxPath, ...(withArchive ? [archivePath] : [])];
    const index = buildIndex({ systemRoot: '', jdexFolder: '', folderPaths: paths, notePaths: [] });
    const walk: JdexLibraryWalk = { rootFolderId: 'root', folderPaths: new Map([
      ['inbox', inboxPath], ...(withArchive ? [['archive', archivePath] as const] : [])
    ]), systemFolderPaths: paths, systemNotes: [note('n1', 'inbox', 'Suelta')] };
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n1', 'inbox', '# Suelta\n\nContenido.\n', { createdAt: new Date(2026, 8, 28).getTime() }));
    return { library, walk, index };
  }

  it('mueve a la .09 con fecha de creación y no toca tipo', async () => {
    const { library, walk, index } = fixture();
    expect(jdexInboxArchiveTarget(note('n1', 'inbox', 'Suelta'), walk, index)?.folderId).toBe('archive');
    await archiveJdexInboxNote(library, markdown, note('n1', 'inbox', 'Suelta'), walk, index, 'YYYY-MM');
    expect((await library.noteRead('n1'))).toMatchObject({ folderId: 'archive', title: '2026-09 Suelta' });
    expect((await library.noteRead('n1'))?.body).toContain('Contenido.');
    expect((await library.noteRead('n1'))?.body).not.toContain('tipo: archivado');
  });

  it('sin carpeta .09 aborta antes de escribir o mover', async () => {
    const { library, walk, index } = fixture(false);
    const move = vi.spyOn(library, 'noteMoveIfUnchanged');
    expect(jdexInboxArchiveTarget(note('n1', 'inbox', 'Suelta'), walk, index)).toBeNull();
    await expect(archiveJdexInboxNote(library, markdown, note('n1', 'inbox', 'Suelta'), walk, index, 'YYYY-MM-DD')).rejects.toThrow('.09');
    expect(move).not.toHaveBeenCalled();
  });

  it('una revisión obsoleta no mueve la nota', async () => {
    const { library, walk, index } = fixture();
    vi.spyOn(library, 'notesRewriteBatch').mockResolvedValue({ written: [], stale: ['n1'], committed: [] });
    const move = vi.spyOn(library, 'noteMoveIfUnchanged');
    await expect(archiveJdexInboxNote(library, markdown, note('n1', 'inbox', 'Suelta'), walk, index, 'YYYY-MM-DD')).rejects.toThrow('cambió');
    expect(move).not.toHaveBeenCalled();
  });
  it('does not move a note changed after its title was dated', async () => {
    const { library, walk, index } = fixture();
    const move = library.noteMoveIfUnchanged.bind(library);
    vi.spyOn(library, 'noteMoveIfUnchanged').mockImplementation(async (...args) => {
      library.saveElsewhere('n1', '# Edición concurrente\n');
      return move(...args);
    });
    await expect(archiveJdexInboxNote(library, markdown, note('n1', 'inbox', 'Suelta'), walk, index, 'YYYY-MM-DD')).rejects.toThrow('cambió antes de moverla');
    expect((await library.noteRead('n1'))).toMatchObject({ folderId: 'inbox', body: '# Edición concurrente\n' });
  });

  it('archives from an origin that is not the .01 (a content ID of the category)', async () => {
    const { library, walk: base } = fixture();
    const contentPath = '20-29 Productos/21 Software/21.11 Hebra';
    const withContent = buildIndex({ systemRoot: '', jdexFolder: '', notePaths: [], folderPaths: [
      '20-29 Productos', '20-29 Productos/21 Software', '20-29 Productos/21 Software/21.01 Inbox', '20-29 Productos/21 Software/21.09 Archivo', contentPath
    ] });
    const walk: JdexLibraryWalk = { ...base, folderPaths: new Map([...base.folderPaths, ['content', contentPath]]) };
    library.seedNote(fakeNote('n2', 'content', '# Idea\n', { createdAt: new Date(2026, 8, 28).getTime() }));
    const ref = note('n2', 'content', 'Idea');
    expect(jdexInboxArchiveTarget(ref, walk, withContent)).toBeNull();
    expect(jdexZeroTarget(ref, walk, withContent, '09')?.folderId).toBe('archive');
    await archiveJdexInboxNote(library, markdown, ref, walk, withContent, 'YYYY-MM');
    expect(await library.noteRead('n2')).toMatchObject({ folderId: 'archive', title: '2026-09 Idea' });
  });

});
