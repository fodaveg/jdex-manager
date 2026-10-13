import { isPluginApiError } from 'hebra-plugin-api/v2';
import { createFakePluginApiV2, type FakePluginApiV2Options } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it, vi } from 'vitest';
import { createJdexJournal } from '../../src/hebra/jdex-journal';
import { JdexPartialRewriteError, rewriteJdexNotes, type JdexRewriteLibrary } from '../../src/hebra/jdex-write';
import { FakeJdexVault, HOST_REWRITE_BATCH_MAX, fakeNote, withHostRewriteBatchLimit } from './support/fakes';

/** El `vault` del host falso del paquete, con notas en la raíz (solo para comparar su límite de lote). */
function packageVault(notes: NonNullable<FakePluginApiV2Options['notes']>) {
  return withHostRewriteBatchLimit(createFakePluginApiV2({ capabilities: ['vault.read', 'vault.write'], notes }).api.vault);
}

/** El doble oficial con las notas dadas (`id -> cuerpo` o `{ body, title }`) en la carpeta `f1`. */
function fakeVault(notes: Record<string, string | { body: string; title: string }>): FakeJdexVault {
  const vault = new FakeJdexVault();
  for (const [id, value] of Object.entries(notes)) {
    vault.seedNote(typeof value === 'string' ? fakeNote(id, 'f1', value) : fakeNote(id, 'f1', value.body, { title: value.title }));
  }
  return vault;
}

/** A FakeJdexVault with `count` notes `n000…`, each with body `# Nota <i>\n`. */
function manyNotes(count: number): { vault: FakeJdexVault; ids: string[] } {
  const vault = new FakeJdexVault();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `n${String(i).padStart(3, '0')}`;
    vault.seedNote(fakeNote(id, 'f1', `# Nota ${i}\n`));
    ids.push(id);
  }
  return { vault, ids };
}

describe('host batch limit in the doubles', () => {
  it('FakeJdexVault and the package vault reject more than 200 notes with invalid-argument', async () => {
    const { vault, ids } = manyNotes(201);
    const entries = await Promise.all(ids.map(async (id) => ({ id, body: '# X\n', expected: (await vault.noteRead(id))!.revision })));
    await expect(vault.notesRewriteBatch(entries)).rejects.toSatisfy((error) => isPluginApiError(error, 'invalid-argument'));
    await expect(vault.notesRewriteBatch(entries.slice(0, HOST_REWRITE_BATCH_MAX))).resolves.toMatchObject({ stale: [] });
    const hostFake = packageVault({ n1: '# A\n' });
    await expect(hostFake.notesRewriteBatch(entries)).rejects.toThrow(/Como mucho 200/);
  });
});

describe('rewriteJdexNotes in batches of 200', () => {
  it('writes 450 notes in 3 calls', async () => {
    const { vault, ids } = manyNotes(450);
    const result = await rewriteJdexNotes(vault, ids, (current) => `${current.body}Añadido\n`, 'Antes de probar');
    expect(result.written).toHaveLength(450);
    expect(result.skipped).toEqual([]);
    expect(vault.rewriteCalls.map((call) => call.entries.length)).toEqual([200, 200, 50]);
    expect(vault.rewriteCalls.every((call) => call.options?.cause === 'Antes de probar')).toBe(true);
    expect((await vault.noteRead('n449'))?.body).toBe('# Nota 449\nAñadido\n');
  });

  it('control: 200 notes go in a single call', async () => {
    const { vault, ids } = manyNotes(200);
    await rewriteJdexNotes(vault, ids, (current) => `${current.body}Añadido\n`);
    expect(vault.rewriteCalls).toHaveLength(1);
  });

  it('a failure after a written batch keeps what was written in the journal and can be undone', async () => {
    const { vault, ids } = manyNotes(450);
    const original = vault.notesRewriteBatch.bind(vault);
    let calls = 0;
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (entries, options) => {
      calls += 1;
      if (calls === 2) throw new Error('Hebra se cerró');
      return original(entries, options);
    });
    const storage = createFakePluginApiV2().api.storage.settings;
    const journal = await createJdexJournal(vault, storage);
    const failure = await journal
      .run('fix', 'Normalizar frontmatter JDex', (tracked) => rewriteJdexNotes(tracked, ids, (current) => `${current.body}Añadido\n`))
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(JdexPartialRewriteError);
    const partial = failure as JdexPartialRewriteError;
    expect(partial.written).toHaveLength(200);
    expect(partial.unwritten).toHaveLength(250);
    expect(partial.message).toContain('Hebra se cerró');
    expect(partial.message).toContain('200');
    // One operation in the journal with exactly the notes that were written.
    const reloaded = await createJdexJournal(vault, storage);
    expect(reloaded.entries()).toHaveLength(1);
    expect(reloaded.entries()[0].effects).toHaveLength(200);
    expect((await vault.noteRead('n000'))?.body).toBe('# Nota 0\nAñadido\n');
    expect((await vault.noteRead('n200'))?.body).toBe('# Nota 200\n');
    // Recoverable: undoing the operation restores every written note.
    const undo = await reloaded.undoLast();
    expect(undo).toEqual({ undone: 200, warnings: [] });
    expect((await vault.noteRead('n000'))?.body).toBe('# Nota 0\n');
    expect((await vault.noteRead('n199'))?.body).toBe('# Nota 199\n');
  });
});

describe('rewriteJdexNotes', () => {
  it('`null` de `nextBody` no escribe nada (contrato «sin marcadores, no se toca»)', async () => {
    const library = fakeVault({ n1: '# Sin marcadores\n' });
    const result = await rewriteJdexNotes(library, ['n1'], () => null);
    expect(result).toEqual({ written: [], skipped: [] });
    expect((await library.noteRead('n1'))?.body).toBe('# Sin marcadores\n');
  });

  it('el mismo cuerpo que ya tenía tampoco escribe', async () => {
    const library = fakeVault({ n1: '# Igual\n' });
    const result = await rewriteJdexNotes(library, ['n1'], (current) => current.body);
    expect(result.written).toHaveLength(0);
  });

  it('un cuerpo distinto se escribe y sale en `written`', async () => {
    const library = fakeVault({ n1: '# Antes\n' });
    const result = await rewriteJdexNotes(library, ['n1'], () => '# Después\n');
    expect(result.written).toEqual(['n1']);
    expect((await library.noteRead('n1'))?.body).toBe('# Después\n');
  });

  it('una nota purgada entre medias (`noteRead` null) no cuenta como escrita ni saltada', async () => {
    const library = fakeVault({});
    const result = await rewriteJdexNotes(library, ['inexistente'], () => '# Nuevo\n');
    expect(result).toEqual({ written: [], skipped: [] });
  });

  it('conserva el título anterior si el cuerpo nuevo no da ninguno (lo hace Hebra al reescribir)', async () => {
    const library = fakeVault({ n1: { body: '', title: 'Título importado' } });
    await rewriteJdexNotes(library, ['n1'], () => 'cuerpo sin título ni encabezado');
    const after = await library.noteRead('n1');
    expect(after?.title).toBe('Título importado');
  });

  it('escribe con la revisión que leyó y con `cause` en las opciones del lote', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n', { revision: { localSeq: 7, bodySha256: 'sha-7' } }));
    await rewriteJdexNotes(vault, ['n1'], () => '# Después\n', 'Antes de probar');
    expect(vault.rewriteCalls).toHaveLength(1);
    expect(vault.rewriteCalls[0].entries).toEqual([
      { id: 'n1', body: '# Después\n', expected: { localSeq: 7, bodySha256: 'sha-7' } }
    ]);
    expect(vault.rewriteCalls[0].options).toEqual({ cause: 'Antes de probar' });
  });

  it('una nota que cambió entre medias (`stale`) se relee y se reintenta UNA vez', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
    let first = true;
    const library: JdexRewriteLibrary = {
      noteRead: (id) => vault.noteRead(id),
      notesRewriteBatch: async (entries, options) => {
        if (first) {
          first = false;
          vault.saveElsewhere('n1', '# Cambiada desde fuera\n');
        }
        return vault.notesRewriteBatch(entries, options);
      }
    };
    const seen: string[] = [];
    const result = await rewriteJdexNotes(library, ['n1'], (current) => {
      seen.push(current.body);
      return `${current.body}Añadido\n`;
    });
    expect(result).toEqual({ written: ['n1'], skipped: [] });
    expect(seen).toEqual(['# Antes\n', '# Cambiada desde fuera\n']);
    expect((await vault.noteRead('n1'))?.body).toBe('# Cambiada desde fuera\nAñadido\n');
  });

  it('si el reintento también queda `stale`, la nota sale en `skipped` sin pisarla', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
    let edits = 0;
    const library: JdexRewriteLibrary = {
      noteRead: (id) => vault.noteRead(id),
      notesRewriteBatch: async (entries, options) => {
        // A different body each time: with real hashes, the same body twice would keep the
        // hash and the (non-strict) batch would accept it, exactly as the host does.
        edits += 1;
        vault.saveElsewhere('n1', `# Otro cambio ${edits}\n`);
        return vault.notesRewriteBatch(entries, options);
      }
    };
    const result = await rewriteJdexNotes(library, ['n1'], () => '# Mío\n');
    expect(result).toEqual({ written: [], skipped: ['n1'] });
    expect((await vault.noteRead('n1'))?.body).toBe('# Otro cambio 2\n');
  });

  it('una nota protegida (`locked`, sin cuerpo) no se toca nunca', async () => {
    const notesRewriteBatch = vi.fn();
    const library: JdexRewriteLibrary = {
      noteRead: async () => ({ ...fakeNote('n1', 'f1', ''), body: null, locked: true }),
      notesRewriteBatch
    };
    const nextBody = vi.fn(() => '# Nuevo\n');
    const result = await rewriteJdexNotes(library, ['n1'], nextBody);
    expect(result).toEqual({ written: [], skipped: [] });
    expect(nextBody).not.toHaveBeenCalled();
    expect(notesRewriteBatch).not.toHaveBeenCalled();
  });
});
