import { describe, expect, it, vi } from 'vitest';
import {
  archiveJdexInboxNote,
  jdexInboxQueue,
  moveJdexInboxNote
} from '../../src/hebra/jdex-inbox-process';
import type { JdexInboxSummary, JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault, fakeNote, fakeSetProperty } from './support/fakes';

const markdown = { setProperty: fakeSetProperty };

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

describe('archiveJdexInboxNote', () => {
  it('marca tipo: archivado y la fecha, conservando el resto del cuerpo', async () => {
    const body = ['---', 'title: Suelta', '---', '', 'Contenido.'].join('\n');
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('n1', 'f-inbox', body));
    const result = await archiveJdexInboxNote(
      library,
      markdown,
      note('n1', 'f-inbox', 'Suelta'),
      '2026-09-28'
    );
    expect(result.written).toEqual(['n1']);
    expect(library.rewriteCalls).toHaveLength(1);
    expect(library.rewriteCalls[0].options).toEqual({ cause: 'Antes de archivar desde el inbox' });
    const written = library.rewriteCalls[0].entries;
    expect(written).toHaveLength(1);
    expect(written[0].body).toContain('tipo: "archivado"');
    expect(written[0].body).toContain('archivado: "2026-09-28"');
    expect(written[0].body).toContain('Contenido.');
  });

  it('nota purgada entre medias: no escribe nada', async () => {
    const notesRewriteBatch = vi.fn();
    const library = { noteRead: async () => null, notesRewriteBatch };
    const result = await archiveJdexInboxNote(
      library,
      markdown,
      note('n1', 'f-inbox', 'Suelta'),
      '2026-09-28'
    );
    expect(result.written).toEqual([]);
    expect(notesRewriteBatch).not.toHaveBeenCalled();
  });
});
