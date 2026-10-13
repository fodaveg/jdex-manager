/**
 * The one create dialog flow (audit 12 Oct 2026, 5.2) with fake ports: no runtime, no DOM.
 */
import type { PluginVault } from 'hebra-plugin-api/v2';
import { describe, expect, it, vi } from 'vitest';
import type { JdIndex } from '../../src/hebra/engine';
import { openJdexCreateDialog, type JdexCreateDialogPorts, type JdexLiveState } from '../../src/hebra/jdex-create-dialog';
import type { JdexCreateOutcome } from '../../src/hebra/jdex-create-write';
import { JDEX_DISPOSED_MESSAGE } from '../../src/hebra/jdex-lifecycle';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';

const opVault = { tag: 'operation vault' } as unknown as PluginVault;
const stateAt = (label: string): JdexLiveState => ({ walk: { label } as unknown as JdexLibraryWalk, index: { label } as unknown as JdIndex });

function harness(overrides: Partial<JdexCreateDialogPorts> = {}) {
  let submit: (request: string) => Promise<void> = async () => {};
  const close = vi.fn();
  let disposed = false;
  let library = stateAt('al abrir');
  const live = vi.fn(async () => library);
  const afterWrite = vi.fn(async () => {});
  const openNote = vi.fn();
  const ports = {
    ui: {
      openModal: vi.fn((mount: (el: HTMLElement) => void) => {
        mount({} as HTMLElement);
        return { close };
      }),
      notice: vi.fn()
    },
    journal: { run: vi.fn((_kind: string, _label: string, action: (vault: PluginVault) => Promise<unknown>) => action(opVault)) },
    isDisposed: () => disposed,
    live,
    afterWrite,
    openNote,
    ...overrides
  } as unknown as JdexCreateDialogPorts & { ui: { notice: ReturnType<typeof vi.fn> } };
  const write = vi.fn(async (_vault: PluginVault, request: string, live: JdexLiveState): Promise<JdexCreateOutcome> => {
    if (request === 'falla') throw new Error('Ya lo usa 21.12 Otro.');
    return { note: { id: `nota-${(live.walk as unknown as { label: string }).label}` }, folderPath: null, folderNotice: request === 'sin carpeta' ? 'La carpeta no se creó.' : null } as unknown as JdexCreateOutcome;
  });
  openJdexCreateDialog<string>(ports, {
    title: 'JDex: crear ID',
    kind: 'create-id',
    label: 'Crear ID',
    mount: (_el, onSubmit) => void (submit = onSubmit),
    write
  });
  return {
    ports,
    live,
    afterWrite,
    openNote,
    write,
    close,
    submit: (request: string) => submit(request),
    turnOff: () => void (disposed = true),
    libraryChangesTo: (label: string) => void (library = stateAt(label))
  };
}

describe('create dialog: one flow for the five dialogs', () => {
  it('writes with the library as it is at submit, inside the journal, then closes and opens the note', async () => {
    const { ports, live, afterWrite, openNote, write, close, submit, libraryChangesTo } = harness();
    expect(live).not.toHaveBeenCalled();
    libraryChangesTo('al enviar');
    await submit('21.12 Nuevo');
    expect(write).toHaveBeenCalledWith(opVault, '21.12 Nuevo', stateAt('al enviar'));
    expect(ports.journal.run).toHaveBeenCalledWith('create-id', 'Crear ID', expect.any(Function));
    expect(afterWrite).toHaveBeenCalledWith(opVault);
    expect(close).toHaveBeenCalledOnce();
    expect(openNote).toHaveBeenCalledWith('nota-al enviar');
  });

  it('a folder notice from the write is shown after closing', async () => {
    const { ports, submit } = harness();
    await submit('sin carpeta');
    expect(ports.ui.notice).toHaveBeenCalledWith('La carpeta no se creó.');
  });

  it('a failed write keeps the dialog open and says why', async () => {
    const { ports, openNote, close, submit } = harness();
    await submit('falla');
    expect(ports.ui.notice).toHaveBeenCalledWith('Ya lo usa 21.12 Otro.');
    expect(close).not.toHaveBeenCalled();
    expect(openNote).not.toHaveBeenCalled();
  });

  it('a submit after the module was turned off writes nothing and does not enter the journal', async () => {
    const { ports, write, submit, turnOff } = harness();
    turnOff();
    await submit('21.12 Nuevo');
    expect(ports.ui.notice).toHaveBeenCalledWith(JDEX_DISPOSED_MESSAGE);
    expect(ports.journal.run).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('a library that cannot be revalidated fails the write before it starts', async () => {
    const { ports, write, submit } = harness({ live: async () => { throw new Error('El índice JDex aún no está listo.'); } });
    await submit('21.12 Nuevo');
    expect(write).not.toHaveBeenCalled();
    expect(ports.ui.notice).toHaveBeenCalledWith('El índice JDex aún no está listo.');
  });
});
