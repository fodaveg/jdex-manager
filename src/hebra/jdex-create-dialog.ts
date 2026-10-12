/**
 * The one create dialog flow of the Hebra runtime (audit 12 Oct 2026, 5.2): ID, category,
 * area, header and `+` child used to repeat open, journal, rewrite, close, notice and open
 * the note, and had drifted apart (some wrote with the walk captured at opening, others
 * with whatever the runtime held at submit).
 *
 * The rule now, the same for all five: what the user CHOSE is fixed when the dialog opens
 * (the creation system, the parent of a child), and what the library CONTAINS is
 * revalidated right before writing (`live()`: pending notices applied, then the current
 * walk and index). A submit that arrives after the module was turned off writes nothing.
 */
import type { PluginModalHandle, PluginUi, PluginVault } from 'hebra-plugin-api';
import type { JdIndex } from './engine';
import type { JdexCreateOutcome } from './jdex-create-write';
import type { JdexJournal } from './jdex-journal';
import { JDEX_DISPOSED_MESSAGE } from './jdex-lifecycle';
import type { JdexLibraryWalk } from './library-index';

/** The library as it is right before a write. */
export interface JdexLiveState {
  readonly walk: JdexLibraryWalk;
  readonly index: JdIndex;
}

export interface JdexCreateDialogPorts {
  readonly ui: Pick<PluginUi, 'openModal' | 'notice'>;
  readonly journal: Pick<JdexJournal, 'run'>;
  isDisposed(): boolean;
  /** Revalidates and returns the walk and index to write with (never the ones captured
   *  when the dialog opened). Runs inside the journal operation. */
  live(): Promise<JdexLiveState>;
  /** Rebuild and derived blocks after the write, with the operation's vault. */
  afterWrite(vault: PluginVault): Promise<void>;
  openNote(id: string): void;
}

export interface JdexCreateDialogSpec<Request> {
  readonly title: string;
  readonly kind: 'create-id' | 'create-structure';
  /** Journal label. */
  readonly label: string;
  /** Mounts the form; it calls `submit` with the request once it validated it. */
  mount(el: HTMLElement, submit: (request: Request) => Promise<void>): void;
  write(vault: PluginVault, request: Request, live: JdexLiveState): Promise<JdexCreateOutcome>;
}

export function openJdexCreateDialog<Request>(
  ports: JdexCreateDialogPorts,
  spec: JdexCreateDialogSpec<Request>
): PluginModalHandle {
  let handle: PluginModalHandle | undefined;
  const submit = async (request: Request): Promise<void> => {
    if (ports.isDisposed()) {
      ports.ui.notice(JDEX_DISPOSED_MESSAGE);
      return;
    }
    try {
      const outcome = await ports.journal.run(spec.kind, spec.label, async (vault) => {
        const created = await spec.write(vault, request, await ports.live());
        await ports.afterWrite(vault);
        return created;
      });
      handle?.close();
      if (outcome.folderNotice) ports.ui.notice(outcome.folderNotice);
      ports.openNote(outcome.note.id);
    } catch (error) {
      ports.ui.notice(error instanceof Error ? error.message : String(error));
    }
  };
  handle = ports.ui.openModal((el) => spec.mount(el, submit), { title: spec.title });
  return handle;
}
