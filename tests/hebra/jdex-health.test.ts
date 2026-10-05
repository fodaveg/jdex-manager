import type { PluginFile } from 'hebra-plugin-api';
import { describe, expect, it, vi } from 'vitest';
import { buildIndex } from '../../src/hebra/engine';
import { createJdexHealthReport } from '../../src/hebra/jdex-health';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';
import { FakeJdexVault } from './support/fakes';

function file(name: string): PluginFile {
  return { id: name, folderId: 'id', name, sha256: 'sha', byteLength: 1, mime: null, createdAt: 0, updatedAt: 0, trashedAt: null };
}

describe('Hebra health', () => {
  it('cuenta notas y adjuntos paginados con el motor compartido y crea una nota nueva', async () => {
    const path = '20-29 Productos/21 Software/21.11 Hebra';
    const walk: JdexLibraryWalk = { rootFolderId: 'root', folderPaths: new Map([['id', path], ['reports', 'Informes']]), systemFolderPaths: [path, 'Informes'], systemNotes: [{ id: 'content', folderId: 'id', title: 'Contenido', path: `${path}/Contenido.md` }] };
    const index = buildIndex({ systemRoot: '', jdexFolder: 'JDex', folderPaths: [path], notePaths: [] });
    const library = new FakeJdexVault();
    const filesPage = vi.fn(async (folderId: string, _subfolders: boolean, cursor: string | null) => {
      if (folderId !== 'id') return { items: [], nextCursor: null };
      return cursor === null ? { items: [file('a.pdf')], nextCursor: 'a.pdf' } : { items: [file('b.png')], nextCursor: null };
    });
    const vault = { noteCreate: library.noteCreate.bind(library), filesPage };
    const first = await createJdexHealthReport(vault, walk, index, { reportsFolder: 'Informes', healthMaxFiles: 1 }, '2026-10-05');
    const second = await createJdexHealthReport(vault, walk, index, { reportsFolder: 'Informes', healthMaxFiles: 1 }, '2026-10-05');
    expect(first.id).not.toBe(second.id);
    expect(first.title).toBe('Salud JD - 2026-10-05');
    expect(first.folderId).toBe('reports');
    expect(first.body).toContain('21.11 Hebra: 3 ficheros');
    expect(filesPage).toHaveBeenCalledWith('id', false, 'a.pdf');
  });

  it('sin carpeta de informes válida no escribe ninguna nota', async () => {
    const noteCreate = vi.fn();
    const filesPage = vi.fn();
    const walk: JdexLibraryWalk = { rootFolderId: 'root', folderPaths: new Map(), systemFolderPaths: [], systemNotes: [] };
    const index = buildIndex({ systemRoot: '', jdexFolder: '', folderPaths: [], notePaths: [] });
    await expect(createJdexHealthReport({ noteCreate, filesPage }, walk, index, { reportsFolder: '', healthMaxFiles: 50 }, '2026-10-05')).rejects.toThrow('carpeta de informes');
    expect(noteCreate).not.toHaveBeenCalled();
  });
});
