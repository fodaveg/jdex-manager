/**
 * Turning the module off stops its writes (audit 12 Oct 2026, finding 13): journal
 * operations still queued when it is disposed do not run, and the dialogs it opened are
 * closed by the cleanup (the host does not track `openModal` for that).
 */
import type { PluginModalHandle, PluginUi } from 'hebra-plugin-api';
import type { JdexJournal } from './jdex-journal';

export const JDEX_DISPOSED_MESSAGE = 'JDex Manager está apagado: no se ha escrito nada.';

/** Same journal, but an operation (or undo) that starts after disposal throws instead. */
export function guardJdexJournal(journal: JdexJournal, isDisposed: () => boolean): JdexJournal {
  // Every argument goes through: `{ automatic: true }` keeps what an undo restored
  // protected, and `expectedId` keeps undo on the operation the dialog showed.
  const run: JdexJournal['run'] = (kind, label, action, ...rest) =>
    journal.run(kind, label, async (vault) => {
      if (isDisposed()) throw new Error(JDEX_DISPOSED_MESSAGE);
      return action(vault);
    }, ...rest);
  const undoLast: JdexJournal['undoLast'] = async (...args) => {
    if (isDisposed()) throw new Error(JDEX_DISPOSED_MESSAGE);
    return journal.undoLast(...args);
  };
  // Everything else (status, discard, merge…) goes to the journal unchanged.
  return new Proxy(journal, {
    get(target, key, receiver) {
      if (key === 'run') return run;
      if (key === 'undoLast') return undoLast;
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
}

/** The host UI with `openModal` tracked: `closeAll` closes every dialog still open. */
export function trackJdexModals(ui: PluginUi): { ui: PluginUi; closeAll(): void } {
  const open = new Set<PluginModalHandle>();
  const openModal: PluginUi['openModal'] = (mount, options) => {
    let handle: PluginModalHandle | null = null;
    handle = ui.openModal(mount, {
      ...options,
      onClosed: () => {
        if (handle) open.delete(handle);
        options?.onClosed?.();
      }
    });
    open.add(handle);
    return handle;
  };
  const tracked = new Proxy(ui, {
    get(target, key, receiver) {
      if (key === 'openModal') return openModal;
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  return {
    ui: tracked,
    closeAll: () => {
      const handles = [...open];
      open.clear();
      for (const handle of handles) handle.close();
    }
  };
}
