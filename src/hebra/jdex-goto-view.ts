/**
 * «JDex: ir a un ID» (lote 3, tarea 2): el selector que abre la paleta ⌘K — el
 * comando (`JDEX_COMMAND_GOTO_ID`) sale ahí solo, como cualquier comando de módulo
 * (`moduleHostCommands` de `LibraryApp.svelte`). Dos paneles en el mismo `<dialog>`
 * de `host.openModal`:
 *
 * 1. `list`: busca el ID por texto libre sobre `id`/`label` (`jdex-id-picker.ts`,
 *    extraído en el lote 4 para que «Procesar inbox» reutilice el MISMO buscador);
 * 2. `actions`: sus cinco acciones, una vez elegido — ir, mover la nota abierta
 *    aquí, buscar dentro (con el FTS de Hebra, vía `context.searchWithinFolder`),
 *    copiar ID, copiar ruta, retirar. Deshabilitadas con su motivo cuando no
 *    aplican (sin carpeta, sin nota JDex, sin nota abierta), nunca ocultas: así se
 *    ve que la acción EXISTE aunque este ID no la admita ahora.
 */
import type { IdEntry } from './engine';
import { mountJdexIdPicker } from './jdex-id-picker';

export interface JdexGotoAction {
  disabled: boolean;
  /** Por qué está deshabilitada; '' cuando no lo está. */
  reason: string;
}

export interface JdexGotoViewOptions {
  entries: readonly IdEntry[];
  hasActiveNote: boolean;
  onGoto(entry: IdEntry): void;
  onMoveNoteHere(entry: IdEntry): void;
  onSearchWithin(entry: IdEntry): void;
  onCopyId(entry: IdEntry): void;
  onCopyPath(entry: IdEntry): void;
  onRetire(entry: IdEntry): void;
  /** Fecha de la nota JDex ya retirada, o `null` si sigue activa. */
  retiredAt?(entry: IdEntry): string | null;
}

function actionsFor(entry: IdEntry, hasActiveNote: boolean, retiredAt: string | null): Record<string, JdexGotoAction> {
  const ok: JdexGotoAction = { disabled: false, reason: '' };
  const noFolder: JdexGotoAction = { disabled: true, reason: `${entry.label} no tiene carpeta.` };
  return {
    goto: entry.folderPath || entry.notePath ? ok : noFolder,
    moveHere: !hasActiveNote
      ? { disabled: true, reason: 'Abre una nota para moverla aquí.' }
      : entry.folderPath
        ? ok
        : noFolder,
    searchWithin: entry.folderPath ? ok : noFolder,
    copyId: ok,
    copyPath: entry.folderPath || entry.notePath ? ok : noFolder,
    retire: entry.notePath
      ? retiredAt !== null
        ? { disabled: true, reason: retiredAt ? `Ya retirado el ${retiredAt}` : 'Ya retirado' }
        : ok
      : { disabled: true, reason: `${entry.label} no tiene nota JDex: no hay nada que retirar.` }
  };
}

export function mountJdexGotoView(el: HTMLElement, options: JdexGotoViewOptions): void {
  let panel: 'list' | 'actions' = 'list';

  const actions = document.createElement('div');
  actions.className = 'hebra-jdex-goto-actions';
  actions.hidden = true;

  const picker = mountJdexIdPicker(el, {
    entries: options.entries,
    onSelect: (entry) => openActions(entry)
  });
  el.append(actions);

  function actionButton(
    label: string,
    action: JdexGotoAction,
    onClick: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hebra-jdex-dialog-secondary hebra-jdex-goto-action';
    button.textContent = label;
    button.disabled = action.disabled;
    if (action.disabled) button.title = action.reason;
    button.addEventListener('click', onClick);
    return button;
  }

  function openActions(entry: IdEntry): void {
    panel = 'actions';
    const acts = actionsFor(entry, options.hasActiveNote, options.retiredAt?.(entry) ?? null);
    picker.root.hidden = true;
    actions.hidden = false;
    actions.replaceChildren();

    const heading = document.createElement('p');
    heading.className = 'hebra-jdex-goto-heading';
    heading.textContent = entry.label;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'hebra-jdex-goto-back';
    back.textContent = '‹ Volver a buscar';
    back.addEventListener('click', () => showList());
    actions.append(back, heading);

    actions.append(
      actionButton('Ir a este ID', acts.goto, () => options.onGoto(entry)),
      actionButton('Mover la nota abierta aquí', acts.moveHere, () =>
        options.onMoveNoteHere(entry)
      ),
      actionButton('Buscar dentro de este ID', acts.searchWithin, () =>
        options.onSearchWithin(entry)
      ),
      actionButton('Copiar ID', acts.copyId, () => options.onCopyId(entry)),
      actionButton('Copiar ruta', acts.copyPath, () => options.onCopyPath(entry)),
      actionButton(acts.retire.disabled && acts.retire.reason.startsWith('Ya retirado') ? acts.retire.reason : 'Retirar este ID', acts.retire, () => options.onRetire(entry))
    );
    back.focus();
  }

  function showList(): void {
    panel = 'list';
    actions.hidden = true;
    picker.root.hidden = false;
    picker.focus();
  }

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel !== 'actions') return;
    event.preventDefault();
    event.stopPropagation();
    showList();
  });

  picker.focus();
}
