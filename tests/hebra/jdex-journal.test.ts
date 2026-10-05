import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it, vi } from 'vitest';
import { createJdexJournal, type JdexJournalVault } from '../../src/hebra/jdex-journal';
import { persistJdexSettings } from '../../src/hebra/settings';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

async function setup() {
  const vault = new FakeJdexVault();
  vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
  vault.seedFolder(fakeFolder('f1', null, '21.11 Antes'));
  const storage = createFakePluginApi().api.storage.settings;
  const journal = await createJdexJournal(vault, storage);
  return { vault, storage, journal };
}

describe('Hebra journal', () => {
  it('persiste una escritura real aunque falle el paso posterior, sin registrar no-ops', async () => {
    const { vault, storage, journal } = await setup();
    await expect(journal.run('fix', 'Arreglar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Después\n', expected: note.revision }]);
      throw new Error('Fallo posterior');
    })).rejects.toThrow('Fallo posterior');
    const reloaded = await createJdexJournal(vault, storage);
    expect(reloaded.entries()).toHaveLength(1);
    expect(reloaded.entries()[0].effects[0]).toMatchObject({ kind: 'note-rewrite', id: 'n1', before: '# Antes\n', after: '# Después\n' });
    expect(reloaded.entries()[0].effects[0]).toHaveProperty('revision');
    await reloaded.run('fix', 'Sin cambios', async () => {});
    expect(reloaded.entries()).toHaveLength(1);
    expect((await reloaded.undoLast()).undone).toBe(1);
    expect((await vault.noteRead('n1'))?.body).toBe('# Antes\n');
  });

  it('conserva las ediciones posteriores y una revisión que cambia durante undo', async () => {
    const { vault, journal } = await setup();
    await journal.run('fix', 'Editar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: 'n1', body: '# Después\n', expected: note.revision }]);
    });
    vault.saveElsewhere('n1', '# Manual\n');
    expect((await journal.undoLast()).warnings.join(' ')).toContain('cambió después');
    expect((await vault.noteRead('n1'))?.body).toBe('# Manual\n');
    vault.saveElsewhere('n1', '# Después\n');
    await journal.run('fix', 'Editar de nuevo', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Final\n', expected: note.revision }]);
    });
    const original = vault.notesRewriteBatch.bind(vault);
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (entries, options) => {
      vault.saveElsewhere('n1', '# Cambio simultáneo\n');
      return original(entries, options);
    });
    const result = await journal.undoLast();
    expect(result.undone).toBe(0);
    expect(result.warnings.join(' ')).toContain('cambió durante');
    expect((await vault.noteRead('n1'))?.body).toBe('# Cambio simultáneo\n');
    expect(journal.entries()).toHaveLength(2);
  });

  it('rechaza deshacer si otra escritura dejó el mismo cuerpo con otra revisión', async () => {
    const { vault, journal } = await setup();
    await journal.run('fix', 'Editar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Después\n', expected: note.revision }]);
    });
    vault.saveElsewhere('n1', '# Después\n');
    const result = await journal.undoLast();
    expect(result.undone).toBe(0);
    expect(result.warnings.join(' ')).toContain('cambió después');
    expect((await vault.noteRead('n1'))?.body).toBe('# Después\n');
  });

  it('deshace dos guardados sucesivos de la misma nota sin confundir su propia revisión', async () => {
    const { api } = createFakePluginApi({ capabilities: ['vault.read', 'vault.write'] });
    const vault = api.vault;
    const original = await vault.noteCreate({ folderId: vault.rootFolderId(), body: '# Antes\n' });
    const journal = await createJdexJournal(vault, api.storage.settings);
    await journal.run('fix', 'Dos guardados', async (tracked) => {
      const first = await tracked.noteSave({ id: original.id, body: '# Intermedio\n', expected: original.revision });
      await tracked.noteSave({ id: original.id, body: '# Final\n', expected: first.revision });
    });
    const result = await journal.undoLast();
    expect(result).toEqual({ undone: 2, warnings: [] });
    expect((await vault.noteRead(original.id))?.body).toBe('# Antes\n');
  });

  it('rebasa la operación anterior después de deshacer otra operación propia', async () => {
    const { vault, journal } = await setup();
    await journal.run('fix', 'Primera', async (tracked) => {
      const before = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: 'n1', body: '# Intermedio\n', expected: before.revision }]);
    });
    await journal.run('fix', 'Segunda', async (tracked) => {
      const middle = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: 'n1', body: '# Final\n', expected: middle.revision }]);
    });
    expect(await journal.undoLast()).toEqual({ undone: 1, warnings: [] });
    expect(await journal.undoLast()).toEqual({ undone: 1, warnings: [] });
    expect((await vault.noteRead('n1'))?.body).toBe('# Antes\n');
  });

  it('registra el commit del lote sin releer, aunque una lectura posterior fallaría', async () => {
    const { vault, journal } = await setup();
    const original = vault.noteRead.bind(vault);
    let committed = false;
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (requests, options) => {
      const result = await FakeJdexVault.prototype.notesRewriteBatch.call(vault, requests, options);
      committed = true;
      return result;
    });
    vi.spyOn(vault, 'noteRead').mockImplementation(async (id) => {
      if (committed) throw new Error('lectura posterior rota');
      return original(id);
    });
    await journal.run('fix', 'Commit confirmado', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Después\n', expected: note.revision }]);
    });
    expect(journal.entries()[0].effects).toMatchObject([{ kind: 'note-rewrite', after: '# Después\n' }]);
  });

  it('deshace creación seguida de reescritura y movimiento seguido de reescritura', async () => {
    const { vault, journal } = await setup();
    const created = await journal.run('create-id', 'Crear y editar', async (tracked) => {
      const note = await tracked.noteCreate({ folderId: 'f1', body: '# Creada\n' });
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Editada\n', expected: note.revision }]);
      return note;
    });
    expect(await journal.undoLast()).toEqual({ undone: 2, warnings: [] });
    expect((await vault.noteRead(created.id))?.trashedAt).not.toBeNull();

    await journal.run('move', 'Mover y editar', async (tracked) => {
      const moved = await tracked.noteMove('n1', 'f2');
      await tracked.notesRewriteBatch([{ id: moved.id, body: '# Tras mover\n', expected: moved.revision }]);
    });
    expect(await journal.undoLast()).toEqual({ undone: 2, warnings: [] });
    expect((await vault.noteRead('n1'))).toMatchObject({ folderId: 'f1', body: '# Antes\n' });
  });

  it('deshace creación de nota intacta y movimientos, conservando cambios manuales', async () => {
    const { vault, journal } = await setup();
    const note = await journal.run('create-id', 'Crear', (tracked) => tracked.noteCreate({ folderId: 'f1', body: '# Nueva\n' }));
    expect((await journal.undoLast()).undone).toBe(1);
    expect((await vault.noteRead(note.id))?.trashedAt).not.toBeNull();
    await journal.run('move', 'Mover', (tracked) => tracked.noteMove('n1', 'f2'));
    expect((await journal.undoLast()).undone).toBe(1);
    expect((await vault.noteRead('n1'))?.folderId).toBe('f1');
    await journal.run('move', 'Mover', (tracked) => tracked.noteMove('n1', 'f2'));
    vault.saveElsewhere('n1', '# Manual después de mover\n');
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.noteRead('n1'))?.folderId).toBe('f2');
  });

  it('deshace renombre y movimiento de carpeta por orden inverso, sin pisar cambios ajenos', async () => {
    const { vault, journal } = await setup();
    await journal.run('retire', 'Retirar', async (tracked) => {
      await tracked.folderRename('f1', '2026-10-05 21.11 Antes');
      await tracked.folderMove('f1', 'archive');
    });
    expect((await journal.undoLast()).undone).toBe(2);
    expect((await vault.foldersList()).find((folder) => folder.id === 'f1')).toMatchObject({ name: '21.11 Antes', parentId: null });
    await journal.run('move', 'Renombrar', (tracked) => tracked.folderRename('f1', '21.11 Después'));
    await vault.folderRename('f1', '21.11 Manual');
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.foldersList()).find((folder) => folder.id === 'f1')?.name).toBe('21.11 Manual');
  });

  it('limita el historial a 20 y los ajustes no borran el diario concurrente', async () => {
    const { vault, storage, journal } = await setup();
    for (let i = 0; i < 23; i += 1) {
      await journal.run('move', `Renombrar ${i}`, (tracked) => tracked.folderRename('f1', `21.11 Versión ${i}`));
    }
    await Promise.all([
      persistJdexSettings(storage, { ...DEFAULT_SETTINGS, subfolderPattern: '70 Adjuntos' }),
      journal.run('move', 'Última', (tracked) => tracked.folderRename('f1', '21.11 Última'))
    ]);
    const reloaded = await createJdexJournal(vault, storage);
    expect(reloaded.entries()).toHaveLength(20);
    expect(reloaded.entries()[19].label).toBe('Última');
    const stored = await storage.load<{ subfolderPattern: string; jdexJournal: unknown[] }>();
    expect(stored?.subfolderPattern).toBe('70 Adjuntos');
    expect(Array.isArray(stored?.jdexJournal)).toBe(true);
  });

  it('usa la extensión de papelera vacía con el estado esperado y conserva el paso si se rechaza', async () => {
    const { vault, storage } = await setup();
    const folderTrashEmpty = vi.fn(async () => false);
    const extended: JdexJournalVault = Object.assign(vault, { folderTrashEmpty });
    const journal = await createJdexJournal(extended, storage);
    const created = await journal.run('create-id', 'Crear carpeta', (tracked) => tracked.folderCreate('f1', '70 Adjuntos'));
    expect((await journal.undoLast()).undone).toBe(0);
    expect(folderTrashEmpty).toHaveBeenCalledWith(created.id, { name: '70 Adjuntos', parentId: 'f1' });
    expect(journal.entries()[0].effects).toHaveLength(1);
    folderTrashEmpty.mockResolvedValue(true);
    expect((await journal.undoLast()).undone).toBe(1);
    expect(journal.entries()).toHaveLength(0);
  });

  it('restaura una nota enviada a papelera con la revisión y marca de trash registradas', async () => {
    const { vault, storage } = await setup();
    const realRestore = vault.noteRestoreIfUnchanged.bind(vault);
    const noteRestoreIfUnchanged = vi.fn().mockResolvedValueOnce(null).mockImplementation(realRestore);
    const journal = await createJdexJournal(Object.assign(vault, { noteRestoreIfUnchanged }), storage);
    await journal.run('fix', 'Papelera', (tracked) => tracked.noteTrash('n1'));
    const trashed = (await vault.noteRead('n1'))!;
    expect((await journal.undoLast()).undone).toBe(0);
    expect(noteRestoreIfUnchanged).toHaveBeenCalledWith('n1', { trashedAt: trashed.trashedAt, revision: trashed.revision });
    expect((await journal.undoLast()).undone).toBe(1);
  });

  it('las cuatro inversas usan CAS y preservan cambios entre la lectura y la escritura', async () => {
    const { vault, journal } = await setup();
    await journal.run('move', 'Mover nota', (tracked) => tracked.noteMove('n1', 'f2'));
    const move = vault.noteMoveIfUnchanged.bind(vault);
    vi.spyOn(vault, 'noteMoveIfUnchanged').mockImplementation(async (...args) => {
      vault.saveElsewhere('n1', '# Manual\n');
      return move(...args);
    });
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.noteRead('n1'))?.folderId).toBe('f2');
    vi.restoreAllMocks();

    await journal.run('move', 'Renombrar carpeta', (tracked) => tracked.folderRename('f1', '21.11 Nueva'));
    const rename = vault.folderRenameIfUnchanged.bind(vault);
    vi.spyOn(vault, 'folderRenameIfUnchanged').mockImplementation(async (...args) => {
      await vault.folderRename('f1', '21.11 Manual');
      return rename(...args);
    });
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.foldersList()).find((folder) => folder.id === 'f1')?.name).toBe('21.11 Manual');
  });
  it('refuses a same-body newer revision before capture and during the strict forward batch', async () => {
    const { api } = createFakePluginApi({ capabilities: ['vault.read', 'vault.write'] });
    const vault = api.vault;
    const original = await vault.noteCreate({ folderId: vault.rootFolderId(), body: '# Original\n' });
    const journal = await createJdexJournal(vault, api.storage.settings);
    await vault.noteSave({ id: original.id, body: original.body!, expected: original.revision });
    const stale = await journal.run('fix', 'Old capture', (tracked) => tracked.notesRewriteBatch([{ id: original.id, body: '# Unexpected\n', expected: original.revision }]));
    expect(stale.stale).toEqual([original.id]);
    expect(journal.entries()).toHaveLength(0);
    const current = (await vault.noteRead(original.id))!;
    const batch = vault.notesRewriteBatch.bind(vault);
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (requests, options) => {
      await vault.noteSave({ id: current.id, body: current.body!, expected: current.revision });
      return batch(requests, options);
    });
    const race = await journal.run('fix', 'Concurrent capture', (tracked) => tracked.notesRewriteBatch([{ id: current.id, body: '# Unexpected\n', expected: current.revision }]));
    expect(race.stale).toEqual([current.id]);
    expect(journal.entries()).toHaveLength(0);
    expect((await vault.noteRead(current.id))?.body).toBe(original.body);
  });

  it('keeps exact committed revisions when another writer edits immediately after the batch', async () => {
    const { vault, journal } = await setup();
    const batch = vault.notesRewriteBatch.bind(vault);
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (requests, options) => {
      const result = await batch(requests, options);
      vault.saveElsewhere('n1', '# Después\n');
      return result;
    });
    await journal.run('fix', 'Edit', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Después\n', expected: note.revision }]);
    });
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.noteRead('n1'))?.body).toBe('# Después\n');
  });

  it('rebasing across operations never adopts a concurrent same-body revision after undo', async () => {
    const { vault, journal } = await setup();
    for (const body of ['# Intermedio\n', '# Final\n']) await journal.run('fix', 'Edit', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body, expected: note.revision }]);
    });
    const batch = vault.notesRewriteBatch.bind(vault);
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (requests, options) => {
      const result = await batch(requests, options);
      vault.saveElsewhere('n1', '# Intermedio\n');
      return result;
    });
    expect((await journal.undoLast()).undone).toBe(1);
    expect((await journal.undoLast()).undone).toBe(0);
    expect(journal.entries()).toHaveLength(1);
  });

  it('undoes nested folder creation in child-before-parent order', async () => {
    const { api } = createFakePluginApi({ capabilities: ['vault.read', 'vault.write'] });
    const journal = await createJdexJournal(api.vault, api.storage.settings);
    await journal.run('fix', 'Nested', async (tracked) => {
      const parent = await tracked.folderCreate(api.vault.rootFolderId(), 'Parent');
      await tracked.folderCreate(parent.id, 'Child');
    });
    expect(await journal.undoLast()).toEqual({ undone: 2, warnings: [] });
    expect((await api.vault.foldersList()).map((folder) => folder.name)).not.toContain('Parent');
  });

  it('journals the transformed committed save body and rejects stale saves without conflict copies', async () => {
    const { api } = createFakePluginApi({ capabilities: ['vault.read', 'vault.write'] });
    const vault = api.vault;
    const note = await vault.noteCreate({ folderId: vault.rootFolderId(), body: '# Before\n' });
    const journal = await createJdexJournal(vault, api.storage.settings);
    const batch = vault.notesRewriteBatch.bind(vault);
    const spy = vi.spyOn(vault, 'notesRewriteBatch').mockImplementation((requests, options) => batch(requests.map((request) => ({ ...request, body: '# Canonical\n' })), options));
    await journal.run('fix', 'Save', (tracked) => tracked.noteSave({ id: note.id, body: '# Requested\n', expected: note.revision }));
    expect(journal.entries()[0].effects[0]).toMatchObject({ after: '# Canonical\n' });
    spy.mockRestore();
    await expect(journal.run('fix', 'Stale save', (tracked) => tracked.noteSave({ id: note.id, body: '# Wrong\n', expected: note.revision }))).rejects.toThrow('cambió antes');
    expect(await journal.undoLast()).toEqual({ undone: 1, warnings: [] });
    expect((await vault.noteRead(note.id))?.body).toBe('# Before\n');
  });

  it('preserves same-body external edits made after creation or between the undo read and trash', async () => {
    const { api } = createFakePluginApi({ capabilities: ['vault.read', 'vault.write'] });
    const vault = api.vault;
    const journal = await createJdexJournal(vault, api.storage.settings);
    const note = await journal.run('create-id', 'Create', (tracked) => tracked.noteCreate({ folderId: vault.rootFolderId(), body: '# New\n' }));
    const trash = vault.noteTrashIfUnchanged.bind(vault);
    vi.spyOn(vault, 'noteTrashIfUnchanged').mockImplementation(async (...args) => {
      await vault.noteSave({ id: note.id, body: note.body!, expected: note.revision });
      return trash(...args);
    });
    expect((await journal.undoLast()).undone).toBe(0);
    expect((await vault.noteRead(note.id))?.trashedAt).toBeNull();
    expect((await journal.undoLast()).undone).toBe(0);
  });

});
