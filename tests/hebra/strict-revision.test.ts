/**
 * Every plugin write that must not lose a race passes `strictRevision: true` (sequence AND
 * hash must match; the default accepts either one). Each of the five call sites has one
 * test per way the note can change between the read and the write, so deleting any
 * `strictRevision` turns a test red:
 *
 * - `sameBodyNewerSeq`: another writer saved the SAME body (hash equal, sequence newer).
 * - `sameSeqOtherBody`: the sequence is the one read but the body hash is not.
 *
 * The fake vault hashes the body (host `sha256HexOf`), so the first scenario is real.
 */
import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import { createJdexFolderRenameGuard } from '../../src/hebra/jdex-folder-rename';
import { archiveJdexInboxNote } from '../../src/hebra/jdex-inbox-process';
import { createJdexJournal } from '../../src/hebra/jdex-journal';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { bodySha256Of, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

type Race = (vault: FakeJdexVault, id: string) => void;

const races: Record<string, Race> = {
  sameBodyNewerSeq: (vault, id) => {
    vault.saveElsewhere(id, vault.peekBody(id));
  },
  sameSeqOtherBody: (vault, id) => {
    const note = vault.peek(id);
    const body = '# Escrito por otro\n';
    vault.seedNote({ ...note, body, title: 'Escrito por otro', revision: { localSeq: note.revision.localSeq, bodySha256: bodySha256Of(body) } });
  }
};

/** Runs `race` once, right before the next `notesRewriteBatch` reaches the vault. */
function raceBeforeNextRewrite(vault: FakeJdexVault, id: string, race: Race): void {
  const original = vault.notesRewriteBatch.bind(vault);
  let armed = true;
  vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (entries, options) => {
    if (armed) {
      armed = false;
      race(vault, id);
    }
    return original(entries, options);
  });
}

describe.each(Object.entries(races))('strictRevision, race «%s»', (_name, race) => {
  async function journalSetup() {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
    vault.seedFolder(fakeFolder('f1', null, '21.11 Antes'));
    const storage = createFakePluginApiV2().api.storage.settings;
    const journal = await createJdexJournal(vault, storage);
    return { vault, storage, journal };
  }

  it('journal.notesRewriteBatch: the write loses the race and nothing is journaled', async () => {
    const { vault, storage, journal } = await journalSetup();
    raceBeforeNextRewrite(vault, 'n1', race);
    await journal.run('fix', 'Editar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      const result = await tracked.notesRewriteBatch([{ id: note.id, body: '# Mío\n', expected: note.revision }]);
      expect(result.written).toEqual([]);
      expect(result.stale).toEqual(['n1']);
    });
    expect((await vault.noteRead('n1'))?.body).not.toBe('# Mío\n');
    expect(journal.entries()).toHaveLength(0);
    expect((await createJdexJournal(vault, storage)).entries()).toHaveLength(0);
  });

  it('a stale first step does not hide a later successful step in the same operation', async () => {
    const { vault, storage, journal } = await journalSetup();
    raceBeforeNextRewrite(vault, 'n1', race);
    await journal.run('fix', 'Retry after stale', async (tracked) => {
      const before = (await tracked.noteRead('n1'))!;
      expect((await tracked.notesRewriteBatch([{ id: 'n1', body: '# Lost\n', expected: before.revision }])).stale).toEqual(['n1']);
      const current = (await tracked.noteRead('n1'))!;
      expect((await tracked.notesRewriteBatch([{ id: 'n1', body: '# Final\n', expected: current.revision }])).written).toEqual(['n1']);
    });
    expect(journal.entries()).toHaveLength(1);
    expect(journal.entries()[0].effects).toMatchObject([{ kind: 'note-rewrite', after: '# Final\n' }]);
    expect((await createJdexJournal(vault, storage)).entries()).toHaveLength(1);
  });

  it('journal.noteSave: refuses to save over the concurrent change', async () => {
    const { vault, journal } = await journalSetup();
    raceBeforeNextRewrite(vault, 'n1', race);
    await expect(journal.run('fix', 'Guardar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.noteSave({ id: note.id, body: '# Mío\n', expected: note.revision });
    })).rejects.toThrow('cambió durante el guardado');
    expect((await vault.noteRead('n1'))?.body).not.toBe('# Mío\n');
  });

  it('journal undo: does not restore over a change made between its check and its write', async () => {
    const { vault, journal } = await journalSetup();
    await journal.run('fix', 'Editar', async (tracked) => {
      const note = (await tracked.noteRead('n1'))!;
      await tracked.notesRewriteBatch([{ id: note.id, body: '# Después\n', expected: note.revision }]);
    });
    raceBeforeNextRewrite(vault, 'n1', race);
    const undo = await journal.undoLast();
    expect(undo.undone).toBe(0);
    expect(undo.warnings.join(' ')).toContain('cambió durante la escritura');
    expect((await vault.noteRead('n1'))?.body).not.toBe('# Antes\n');
  });

  it('folder-rename pair: the note keeps what the other writer put', async () => {
    const idPath = '20-29 Productos/21 Productos de software/21.11 Hebra';
    const notePath = '00.00 JDex/21.11 Hebra.md';
    const input: IndexInput = {
      systemRoot: '',
      jdexFolder: '00.00 JDex',
      folderPaths: ['00.00 JDex', '20-29 Productos', '20-29 Productos/21 Productos de software', idPath],
      notePaths: [notePath]
    };
    const index = buildIndex(input);
    const walk: JdexLibraryWalk = {
      rootFolderId: 'root',
      folderPaths: new Map([['f-jdex', '00.00 JDex'], ['f-2111', idPath]]),
      systemFolderPaths: [],
      systemNotes: [{ id: 'n1', folderId: 'f-jdex', title: '21.11 Hebra', path: notePath }]
    };
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f-jdex', '# 21.11 Hebra\n'));
    const notice = vi.fn();
    const guard = createJdexFolderRenameGuard({
      ui: { openModal: vi.fn(), notice },
      markdown: createFakePluginApiV2().api.markdown,
      snapshot: () => ({ walk, index, settings: { jdexFolder: '00.00 JDex', systemRoot: '', renamePairsWithoutAsking: true } }),
      write: async (_label, action) => action(vault),
      report: (error) => { throw error; }
    });
    expect(await guard.confirm({ kind: 'folder-rename', folderId: 'f-2111', newName: '21.11 Nuevo' })).toBe(true);
    raceBeforeNextRewrite(vault, 'n1', race);
    guard.foldersChanged([fakeFolder('f-2111', 'f-cat', '21.11 Nuevo')]);
    await vi.waitFor(() => expect(notice).toHaveBeenCalledWith('La nota cambió desde el aviso; no se ha tocado.'));
    expect(vault.peekBody('n1')).not.toContain('Nuevo');
  });

  it('inbox archive: a note changed after the read is not dated and not moved', async () => {
    const inboxPath = '20-29 Productos/21 Software/21.01 Inbox';
    const archivePath = '20-29 Productos/21 Software/21.09 Archivo';
    const paths = ['20-29 Productos', '20-29 Productos/21 Software', inboxPath, archivePath];
    const index = buildIndex({ systemRoot: '', jdexFolder: '', folderPaths: paths, notePaths: [] });
    const ref: JdexNoteRef = { id: 'n1', folderId: 'inbox', title: 'Suelta', path: 'Suelta.md' };
    const walk: JdexLibraryWalk = { rootFolderId: 'root', folderPaths: new Map([['inbox', inboxPath], ['archive', archivePath]]), systemFolderPaths: paths, systemNotes: [ref] };
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'inbox', '# Suelta\n\nContenido.\n', { createdAt: new Date(2026, 8, 28).getTime() }));
    raceBeforeNextRewrite(vault, 'n1', race);
    const move = vi.spyOn(vault, 'noteMoveIfUnchanged');
    await expect(archiveJdexInboxNote(vault, createFakePluginApiV2().api.markdown, ref, walk, index, 'YYYY-MM')).rejects.toThrow('cambió antes de fecharla');
    expect(move).not.toHaveBeenCalled();
    expect(vault.peek('n1').folderId).toBe('inbox');
  });
});
