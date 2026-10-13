import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildIndex } from '../../src/hebra/engine';
import {
  archiveJdexInboxNote,
  jdexInboxArchiveTarget,
  jdexInboxQueue,
  jdexZeroTarget,
  moveJdexInboxNote,
  moveJdexInboxNoteCreatingFolder,
  trashJdexInboxNote
} from '../../src/hebra/jdex-inbox-process';
import type { JdexInboxSummary, JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
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

describe('moveJdexInboxNote', () => {
  it('resuelve la carpeta de destino y llama a noteMove', async () => {
    const walk = {
      rootFolderId: 'root',
      folderPaths: new Map([['f-target', '21 Cat/21.11 Hebra']])
    };
    const noteMove = vi.fn(async () => fakeNote('n1', 'f-target', ''));
    await moveJdexInboxNote({ noteMove }, note('n1', 'f-inbox', 'Suelta'), walk, '21 Cat/21.11 Hebra');
    expect(noteMove).toHaveBeenCalledWith('n1', 'f-target');
  });

  it('sin carpeta que resuelva la ruta, lanza', async () => {
    const noteMove = vi.fn(async () => fakeNote('n1', 'f-target', ''));
    await expect(
      moveJdexInboxNote(
        { noteMove },
        note('n1', 'f-inbox', 'Suelta'),
        { rootFolderId: 'root', folderPaths: new Map() },
        'no existe'
      )
    ).rejects.toThrow('No se encontró la carpeta de destino.');
    expect(noteMove).not.toHaveBeenCalled();
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

describe('moveJdexInboxNoteCreatingFolder', () => {
  const folders = ['20-29 Productos', '20-29 Productos/21 Software'];
  const jdex = '00-09 Sistema/00 Sistema/00.00 JDex';
  const index = buildIndex({ systemRoot: '', jdexFolder: jdex, folderPaths: [...folders, jdex], notePaths: [`${jdex}/21.11 Hebra.md`] });
  const entry = index.ids.find((e) => e.id === '21.11')!;

  it('creates the ID folder under its category and moves the note there', async () => {
    const library = new FakeJdexVault();
    library.seedFolder(fakeFolder('cat', 'root', '21 Software'));
    library.seedNote(fakeNote('n1', 'inbox', '# Suelta\n'));
    const walk = { rootFolderId: 'root', folderPaths: new Map([['cat', '20-29 Productos/21 Software']]) };
    expect(entry.folderPath).toBeUndefined();
    await moveJdexInboxNoteCreatingFolder(library, note('n1', 'inbox', 'Suelta'), walk, index, entry);
    const created = (await library.foldersList()).find((f) => f.name === '21.11 Hebra');
    expect(created?.parentId).toBe('cat');
    expect((await library.noteRead('n1'))?.folderId).toBe(created?.id);
  });

  it('refuses an ID whose category has no folder, creating nothing', async () => {
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n1', 'inbox', '# Suelta\n'));
    const create = vi.spyOn(library, 'folderCreate');
    await expect(moveJdexInboxNoteCreatingFolder(library, note('n1', 'inbox', 'Suelta'), { rootFolderId: 'root', folderPaths: new Map() }, index, entry)).rejects.toThrow('no tiene carpeta');
    expect(create).not.toHaveBeenCalled();
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
