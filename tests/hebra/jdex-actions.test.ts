/**
 * Copy, move and retire with fake ports (audit 12 Oct 2026, 5.1 cut 5): no runtime, no DOM.
 */
import type { PluginVault } from 'hebra-plugin-api';
import { describe, expect, it, vi } from 'vitest';
import { buildIndex, type IdEntry } from '../../src/hebra/engine';
import { copyJdexText, jdexRetireQuestion, moveJdexNoteToEntry, retireJdexEntry, type JdexActionPorts } from '../../src/hebra/jdex-actions';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';

const JDEX = 'J';
const walk = { rootFolderId: 'root', folderPaths: new Map([['f-id', 'A/21/21.11 Algo']]) } as unknown as JdexLibraryWalk;
const entry: IdEntry = { id: '21.11', category: '21', title: 'Algo', label: '21.11 Algo', notePath: `${JDEX}/21.11 Algo.md`, folderPath: 'A/21/21.11 Algo' };
const index = buildIndex({ systemRoot: '', jdexFolder: JDEX, folderPaths: [], notePaths: [`${JDEX}/21.11 Algo.md`] });
const repeated = buildIndex({ systemRoot: '', jdexFolder: JDEX, folderPaths: [], notePaths: [`${JDEX}/21.11 Algo.md`, `${JDEX}/21.11 Otro.md`] });
const context = { index, settings: { jdexFolder: JDEX, templatesFolder: '', reportsFolder: '' } };
const noteMove = vi.fn(async () => {});
const opVault = { noteMove } as unknown as PluginVault;

function ports(answer = true) {
  const notice = vi.fn<(text: string) => void>();
  const rebuild = vi.fn(async () => {});
  const afterWrite = vi.fn(async () => {});
  const report = vi.fn();
  const confirm = vi.fn(async () => answer);
  const run = vi.fn((_kind: string, _label: string, action: (vault: PluginVault) => Promise<unknown>) => action(opVault));
  const value = { notice, rebuild, afterWrite, report, confirm, journal: { run } } as unknown as JdexActionPorts;
  return { value, notice, rebuild, afterWrite, report, confirm, run };
}

describe('Hebra actions: copy', () => {
  it('says it copied, or that it could not', async () => {
    const { value, notice } = ports();
    await copyJdexText(value, async () => {}, '21.11', 'ID copiado.');
    await copyJdexText(value, async () => { throw new Error('denegado'); }, '21.11', 'ID copiado.');
    expect(notice.mock.calls).toEqual([['ID copiado.'], ['No se pudo copiar.']]);
  });
});

describe('Hebra actions: move the active note to an ID', () => {
  it('moves it in the journal, says so and rebuilds', async () => {
    const { value, notice, rebuild, run } = ports();
    await moveJdexNoteToEntry(value, { id: 'n-1' }, entry, walk, context);
    expect(run).toHaveBeenCalledWith('move', 'Mover nota a 21.11 Algo', expect.any(Function));
    expect(noteMove).toHaveBeenCalledWith('n-1', 'f-id');
    expect(notice).toHaveBeenCalledWith('Movida a 21.11 Algo.');
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('never creates a missing ID folder: an ID without one is left alone, silently', async () => {
    const { value, notice, run } = ports();
    await moveJdexNoteToEntry(value, { id: 'n-1', title: 'Nota' }, { ...entry, folderPath: undefined }, walk, context);
    expect(notice).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('without the folder of the ID, nothing is written', async () => {
    const { value, notice, run } = ports();
    await moveJdexNoteToEntry(value, { id: 'n-1' }, { ...entry, folderPath: 'A/21/21.12 Falta' }, walk, context);
    expect(notice).toHaveBeenCalledWith('No se encontró la carpeta de 21.11 Algo.');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Hebra actions: retire an ID', () => {
  it('asks first, retires in the journal, refreshes derived blocks and says where the folder went', async () => {
    const { value, notice, confirm, afterWrite, run } = ports(true);
    await retireJdexEntry(value, entry, index, async () => ({ moved: true }));
    expect(confirm).toHaveBeenCalledWith(jdexRetireQuestion(entry), 'Retirar');
    expect(run).toHaveBeenCalledWith('retire', 'Retirar 21.11 Algo', expect.any(Function));
    expect(afterWrite).toHaveBeenCalledWith(opVault);
    expect(notice).toHaveBeenCalledWith('21.11 Algo retirado: movido a su archivo.');
  });

  it('cancelled, nothing is written', async () => {
    const { value, run } = ports(false);
    await retireJdexEntry(value, entry, index, async () => ({ moved: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it('a repeated number is refused before asking', async () => {
    const { value, notice, confirm } = ports(true);
    await retireJdexEntry(value, entry, repeated, async () => ({ moved: true }));
    expect(confirm).not.toHaveBeenCalled();
    expect(notice.mock.calls[0][0]).toContain('está repetido');
  });

  it('a failure says why and rebuilds to show what did happen', async () => {
    const { value, notice, rebuild } = ports(true);
    await retireJdexEntry(value, entry, index, async () => { throw new Error('No se pudo mover la carpeta.'); });
    expect(notice).toHaveBeenCalledWith('No se pudo mover la carpeta.');
    expect(rebuild).toHaveBeenCalledOnce();
  });
});
