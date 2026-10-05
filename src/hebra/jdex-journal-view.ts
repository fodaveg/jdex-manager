/** Shows the stored operations and offers undo for the last one. */
import type { Operation } from './engine';
import type { JdexJournalEffect } from './jdex-journal';

export function mountJdexJournalView(el: HTMLElement, options: {
  entries: readonly Operation<JdexJournalEffect>[];
  onUndo(): Promise<void>;
}): void {
  const list = document.createElement('ol');
  for (const operation of [...options.entries].reverse()) {
    const row = document.createElement('li');
    row.textContent = `${operation.label} · ${operation.effects.length} paso(s) · ${new Date(operation.at).toLocaleString()}`;
    list.append(row);
  }
  if (options.entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay operaciones que deshacer.';
    el.append(empty);
    return;
  }
  const info = document.createElement('p');
  info.textContent = 'Deshacer comprueba el estado actual y se detiene si encuentra cambios posteriores.';
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'hebra-jdex-dialog-primary';
  undo.textContent = 'Deshacer la última operación';
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  undo.addEventListener('click', () => {
    undo.disabled = true;
    void options.onUndo().catch((reason: unknown) => {
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }).finally(() => { undo.disabled = false; });
  });
  el.append(list, info, error, undo);
}
