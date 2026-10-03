import { createFakePluginApi, type FakePluginApiOptions } from 'hebra-plugin-api/testing';
import { describe, expect, it, vi } from 'vitest';
import { rewriteJdexNotes, type JdexRewriteLibrary } from '../../src/hebra/jdex-write';
import { FakeJdexVault, fakeNote } from './support/fakes';

/** El `vault` del host falso del paquete, con notas en la raíz. */
function fakeVault(notes: NonNullable<FakePluginApiOptions['notes']>) {
  return createFakePluginApi({ capabilities: ['vault.read', 'vault.write'], notes }).api.vault;
}

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
    const library: JdexRewriteLibrary = {
      noteRead: (id) => vault.noteRead(id),
      notesRewriteBatch: async (entries, options) => {
        vault.saveElsewhere('n1', '# Otro cambio\n');
        return vault.notesRewriteBatch(entries, options);
      }
    };
    const result = await rewriteJdexNotes(library, ['n1'], () => '# Mío\n');
    expect(result).toEqual({ written: [], skipped: ['n1'] });
    expect((await vault.noteRead('n1'))?.body).toBe('# Otro cambio\n');
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
