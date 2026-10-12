/** Shows the stored operations and offers undo, or discard, for the last one. */
import type { Operation } from './engine';
import type { JdexJournalEffect } from './jdex-journal';

export function mountJdexJournalView(el: HTMLElement, options: {
  entries: readonly Operation<JdexJournalEffect>[];
  onUndo(): Promise<void>;
  /** Removes the last entry without touching notes; asked for twice before it runs. */
  onDiscard?(): Promise<void>;
  status?: { unsaved: boolean; readOnly: boolean };
}): void {
  const list = document.createElement('ol');
  for (const operation of [...options.entries].reverse()) {
    const row = document.createElement('li');
    row.textContent = `${operation.label} · ${operation.effects.length} paso(s) · ${new Date(operation.at).toLocaleString()}`;
    list.append(row);
  }
  if (options.status?.unsaved) {
    const unsaved = document.createElement('p');
    unsaved.setAttribute('role', 'alert');
    unsaved.textContent = 'El diario no se pudo guardar: lo que muestra solo está en memoria hasta el próximo guardado.';
    el.append(unsaved);
  }
  if (options.entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = options.status?.readOnly
      ? 'El diario lo escribió una versión más nueva de JDex Manager; se conserva sin usarlo.'
      : 'No hay operaciones que deshacer.';
    el.append(empty);
    return;
  }
  const info = document.createElement('p');
  info.textContent = 'Deshacer comprueba el estado actual y se detiene si encuentra cambios posteriores. Si la última operación no se puede deshacer, descártala para llegar a las anteriores: descartar no toca ninguna nota.';
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
  if (!options.onDiscard) return;
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'hebra-jdex-dialog-discard';
  discard.textContent = 'Descartar la última entrada';
  let armed = false;
  discard.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      discard.textContent = 'Confirmar: quitar del diario sin tocar notas';
      return;
    }
    discard.disabled = true;
    void options.onDiscard!().catch((reason: unknown) => {
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }).finally(() => { discard.disabled = false; });
  });
  el.append(discard);
}
