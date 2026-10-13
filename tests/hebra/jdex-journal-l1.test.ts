import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import { createJdexJournal, JdexJournalSaveError, jdexDeviceId, type JdexJournalEffect } from '../../src/hebra/jdex-journal';
import { persistJdexSettings } from '../../src/hebra/settings';
import { DEFAULT_SETTINGS, JOURNAL_VERSION, type Operation } from '../../src/hebra/engine';
import { FakeJdexVault, fakeDeviceExtension, fakeFolder, fakeNote } from './support/fakes';

function storageOf() {
  const base = createFakePluginApiV2().api.storage.settings;
  // Like a real store: what is saved is a copy, not the live journal objects.
  const save = vi.fn((value: unknown) => base.save(JSON.parse(JSON.stringify(value)) as unknown));
  return { storage: { load: <T>() => base.load<T>(), save }, save };
}

function vaultOf() {
  const vault = new FakeJdexVault();
  vault.seedFolder(fakeFolder('f1', null, '21 Cat'));
  vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
  vault.seedNote(fakeNote('n2', 'f1', '# Dos\n'));
  return vault;
}

const rewrite = (id: string, body: string) => async (tracked: FakeJdexVault) => {
  const note = (await tracked.noteRead(id))!;
  await tracked.notesRewriteBatch([{ id, body, expected: note.revision }]);
};

describe('Hebra undo acts on the confirmed operation', () => {
  it('does not undo another operation queued between confirmation and execution', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    await journal.run('fix', 'Primera', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault));
    const confirmed = journal.entries()[0].id!;
    // A pending write is already in the queue when the user confirms.
    const pending = journal.run('fix', 'Pendiente', (tracked) => rewrite('n2', '# Dos editado\n')(tracked as FakeJdexVault));
    const result = await journal.undoLast(confirmed);
    await pending;
    expect(result.undone).toBe(0);
    expect(result.warnings.join(' ')).toContain('cambió desde que se abrió');
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno editado\n');
    expect((await vault.noteRead('n2'))?.body).toBe('# Dos editado\n');
    expect(journal.entries().map((op) => op.label)).toEqual(['Primera', 'Pendiente']);
  });

  it('undoes the confirmed operation when nothing changed (control)', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    await journal.run('fix', 'Primera', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault));
    expect((await journal.undoLast(journal.entries()[0].id)).undone).toBe(1);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    expect(journal.entries()).toEqual([]);
  });

  it('refuses an operation of another device', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const other = await createJdexJournal(vault, storage, { device: 'B' });
    await other.run('fix', 'De B', (tracked) => rewrite('n1', '# B\n')(tracked as FakeJdexVault));
    const mine = await createJdexJournal(vault, storage, { device: 'A' });
    const result = await mine.undoLast(mine.entries()[0].id);
    expect(result.warnings.join(' ')).toContain('otro dispositivo');
    expect((await vault.noteRead('n1'))?.body).toBe('# B\n');
  });
});

describe('Hebra discard', () => {
  it('after editing a created note, undo refuses, discard removes the entry and the previous one undoes', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    await journal.run('fix', 'Editar', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault));
    const created = await journal.run('create-id', 'Crear', (tracked) => tracked.noteCreate({ folderId: 'f1', body: '# Nueva\n' }));
    vault.saveElsewhere(created.id, '# Nueva con cambios\n');
    const last = journal.entries()[1].id!;
    expect((await journal.undoLast(last)).undone).toBe(0);
    expect(await journal.discardLast(last)).toBe(true);
    expect((await vault.noteRead(created.id))?.body).toBe('# Nueva con cambios\n');
    expect((await journal.undoLast(journal.entries()[0].id)).undone).toBe(1);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    const reloaded = await createJdexJournal(vault, storage, { device: 'A' });
    expect(reloaded.entries()).toEqual([]);
  });
});

describe('Hebra settings and journal changed elsewhere', () => {
  it('an external jdexFolder change followed by a local save keeps the external value', async () => {
    const { storage } = storageOf();
    const before = { ...DEFAULT_SETTINGS, jdexFolder: 'Viejo' };
    await persistJdexSettings(storage, before);
    await storage.save({ ...(await storage.load<object>()), jdexFolder: 'Externo' });
    await persistJdexSettings(storage, { ...before, subfolderPattern: '70 Adjuntos' }, before);
    expect(await storage.load()).toMatchObject({ jdexFolder: 'Externo', subfolderPattern: '70 Adjuntos' });
  });

  it('joins journal entries from both sides by identity without an invalid undo sequence', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const a = await createJdexJournal(vault, storage, { device: 'A' });
    const b = await createJdexJournal(vault, storage, { device: 'B' });
    await a.run('fix', 'De A', (tracked) => rewrite('n1', '# A\n')(tracked as FakeJdexVault));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await b.run('fix', 'De B', (tracked) => rewrite('n2', '# B\n')(tracked as FakeJdexVault));
    a.absorb(await storage.load());
    expect(a.entries().map((op) => op.label)).toEqual(['De A', 'De B']);
    // The last operation is B's: A may not undo past it.
    expect((await a.undoLast(a.entries()[1].id)).warnings.join(' ')).toContain('otro dispositivo');
    expect((await vault.noteRead('n1'))?.body).toBe('# A\n');
    expect((await b.undoLast(b.entries()[b.entries().length - 1].id)).undone).toBe(1);
    a.absorb(await storage.load());
    expect(a.entries().map((op) => op.label)).toEqual(['De A']);
    expect((await a.undoLast(a.entries()[0].id)).undone).toBe(1);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
  });

  it('keeps a stable device id in device storage', () => {
    const device = createFakePluginApiV2({ extensions: fakeDeviceExtension() }).api.storage.device;
    expect(jdexDeviceId(device)).toBe(jdexDeviceId(device));
  });
});

describe('Hebra journal save policy', () => {
  it('retries a save that fails once and keeps the entry', async () => {
    const vault = vaultOf();
    const { storage, save } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    save.mockRejectedValueOnce(new Error('cuota'));
    await journal.run('fix', 'Editar', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault));
    const reloaded = await createJdexJournal(vault, storage, { device: 'A' });
    expect(reloaded.entries()[0].effects).toMatchObject([{ kind: 'note-rewrite', id: 'n1', after: '# Uno editado\n' }]);
    expect(reloaded.entries()[0].effects[0]).not.toHaveProperty('pending');
  });

  it('writes nothing when the intent cannot be saved, and does not declare success', async () => {
    const vault = vaultOf();
    const { storage, save } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    save.mockRejectedValueOnce(new Error('cuota')).mockRejectedValueOnce(new Error('cuota'));
    await expect(journal.run('fix', 'Editar', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault))).rejects.toBeInstanceOf(JdexJournalSaveError);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    expect(journal.status().unsaved).toBe(true);
    await journal.run('fix', 'Siguiente', (tracked) => rewrite('n2', '# Dos editado\n')(tracked as FakeJdexVault));
    expect(journal.status().unsaved).toBe(false);
  });

  it('a close between the write and its confirmation leaves an entry that undo explains and discard clears', async () => {
    const vault = vaultOf();
    const { storage, save } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    // Intent saved, write done, then every later save fails: the app "closes" here.
    let saves = 0;
    const real = save.getMockImplementation()!;
    save.mockImplementation((value) => (saves++ === 0 ? real(value) : Promise.reject(new Error('cerrada'))));
    await expect(journal.run('fix', 'Editar', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault))).rejects.toThrow();
    save.mockImplementation(real);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno editado\n');
    const reloaded = await createJdexJournal(vault, storage, { device: 'A' });
    expect(reloaded.entries()[0].effects[0]).toMatchObject({ kind: 'note-rewrite', pending: true });
    const id = reloaded.entries()[0].id!;
    expect((await reloaded.undoLast(id)).warnings.join(' ')).toContain('interrumpió');
    expect(await reloaded.discardLast(id)).toBe(true);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno editado\n');
  });

  it('a close after an inverse ran but before its removal was saved does not block the retry', async () => {
    const vault = vaultOf();
    const { storage, save } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    await journal.run('fix', 'Editar', (tracked) => rewrite('n1', '# Uno editado\n')(tracked as FakeJdexVault));
    const real = save.getMockImplementation()!;
    let saves = 0;
    // First save of the undo (the `undoing` marker) succeeds; the removal fails: closed.
    save.mockImplementation((value) => (saves++ === 0 ? real(value) : Promise.reject(new Error('cerrada'))));
    await expect(journal.undoLast(journal.entries()[0].id)).rejects.toThrow();
    save.mockImplementation(real);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    const reloaded = await createJdexJournal(vault, storage, { device: 'A' });
    expect(reloaded.entries()).toEqual([]);
  });
});

describe('Hebra undo is not redone by automatic writes', () => {
  it('automatic runs skip what undo restored until a later change; a user operation lifts it', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    let now = 0;
    const journal = await createJdexJournal(vault, storage, { device: 'A', now: () => now, settleMs: 1000 });
    await journal.run('fix', 'Normalizar', (tracked) => rewrite('n1', '# Normalizado\n')(tracked as FakeJdexVault));
    await journal.undoLast(journal.entries()[0].id);
    const automatic = () => journal.run('fix', 'Cabeceras vivas', (tracked) => rewrite('n1', '# Normalizado\n')(tracked as FakeJdexVault), { automatic: true });
    journal.observe(['n1']); // the undo's own notice, inside the settle window
    await automatic();
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    expect(journal.entries()).toEqual([]);
    now = 5000;
    journal.observe(['n2']); // an unrelated change does not lift n1
    await automatic();
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    journal.observe(['n1']); // a real change of n1 after the window does
    await automatic();
    expect((await vault.noteRead('n1'))?.body).toBe('# Normalizado\n');
  });

  it('two undos reach the earlier operation without an automatic entry in between', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A', now: () => 0 });
    await journal.run('create-id', 'Crear', (tracked) => rewrite('n2', '# Dos creado\n')(tracked as FakeJdexVault));
    await journal.run('fix', 'Cabeceras', (tracked) => rewrite('n1', '# Con lista\n')(tracked as FakeJdexVault));
    await journal.undoLast(journal.entries()[1].id);
    await journal.run('fix', 'Cabeceras vivas', (tracked) => rewrite('n1', '# Con lista\n')(tracked as FakeJdexVault), { automatic: true });
    expect(journal.entries().map((op) => op.label)).toEqual(['Crear']);
    await journal.undoLast(journal.entries()[0].id);
    expect((await vault.noteRead('n2'))?.body).toBe('# Dos\n');
  });
});

describe('Hebra journal and L2 chunked writes', () => {
  it('several batches in one run are one entry, saved after each batch, kept and undoable when the run throws', async () => {
    const vault = vaultOf();
    const { storage, save } = storageOf();
    const journal = await createJdexJournal(vault, storage, { device: 'A' });
    await expect(journal.run('fix', 'Troceado', async (tracked) => {
      await rewrite('n1', '# Lote 1\n')(tracked as FakeJdexVault);
      const savesAfterFirst = save.mock.calls.length;
      await rewrite('n2', '# Lote 2\n')(tracked as FakeJdexVault);
      expect(save.mock.calls.length).toBeGreaterThan(savesAfterFirst);
      throw new Error('fallo del lote 3');
    })).rejects.toThrow('lote 3');
    const reloaded = await createJdexJournal(vault, storage, { device: 'A' });
    expect(reloaded.entries()).toHaveLength(1);
    expect(reloaded.entries()[0].effects.map((effect) => effect.id)).toEqual(['n1', 'n2']);
    expect((await reloaded.undoLast(reloaded.entries()[0].id)).undone).toBe(2);
    expect((await vault.noteRead('n1'))?.body).toBe('# Uno\n');
    expect((await vault.noteRead('n2'))?.body).toBe('# Dos\n');
  });
});

describe('Hebra journals from other versions', () => {
  it('gives ids to 0.4.x entries, keeps an unknown step with a warning and leaves a newer journal untouched', async () => {
    const vault = vaultOf();
    const { storage } = storageOf();
    const unknown = { kind: 'fix', label: 'Futuro', at: '2026-10-01T00:00:00.000Z', effects: [{ kind: 'teleported', id: 'n1' } as unknown as JdexJournalEffect] } satisfies Operation<JdexJournalEffect>;
    await storage.save({ jdexJournal: [unknown] });
    const journal = await createJdexJournal(vault, storage);
    expect(journal.entries()[0].id).toBe('legacy:2026-10-01T00:00:00.000Z:Futuro');
    expect((await journal.undoLast(journal.entries()[0].id)).warnings.join(' ')).toContain('otra versión');
    expect(journal.entries()[0].effects).toHaveLength(1);
    const future = { jdexJournalVersion: JOURNAL_VERSION + 1, jdexJournal: [{ shape: 'nueva' }] };
    await storage.save(future);
    const readOnly = await createJdexJournal(vault, storage);
    await readOnly.run('fix', 'Ignorada', (tracked) => rewrite('n1', '# Otra\n')(tracked as FakeJdexVault));
    expect(await storage.load()).toEqual(future);
    expect(readOnly.status().readOnly).toBe(true);
  });
});
