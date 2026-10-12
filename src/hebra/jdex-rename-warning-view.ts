/**
 * El aviso de «JDex: avisar antes de renumerar un ID o cambiarlo de categoría al
 * renombrar o mover» (lote 3, tarea 1): el mensaje de `jdexRenameWarningMessage` con
 * «Cancelar» (foco inicial, la opción segura) y el botón que confirma, con su propio
 * verbo (`confirmLabel`). Nunca actúa sola: quien la abre decide qué hacer con cada
 * botón (`jdex-folder-rename.ts` rehace el cambio solo al confirmar; retirar un ID
 * retira solo al confirmar).
 */
import { primaryButton } from './jdex-dialog-fields';

export interface JdexRenameWarningViewOptions {
  message: string;
  /** The verb of the confirming button («Retirar», «Renombrar igualmente»); «Continuar»
   *  when absent. */
  confirmLabel?: string;
  onContinue(): void;
  onCancel(): void;
}

export function mountJdexRenameWarningView(
  el: HTMLElement,
  options: JdexRenameWarningViewOptions
): void {
  const message = document.createElement('p');
  message.className = 'hebra-jdex-warning-message';
  message.textContent = options.message;
  el.append(message);

  const actions = document.createElement('div');
  actions.className = 'hebra-jdex-warning-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'hebra-jdex-dialog-secondary';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => options.onCancel());
  const proceed = primaryButton(options.confirmLabel ?? 'Continuar', () => options.onContinue());
  actions.append(cancel, proceed);
  el.append(actions);

  // Cancelar es la opción segura: recibe el foco inicial, como el botón por defecto
  // de un `<dialog>` cuando el aviso es destructivo.
  cancel.focus();
}
