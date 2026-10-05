/**
 * «Procesar inbox» (lote 4, tarea 1, encargo de David, 28 sep 2026): recorre la cola
 * de notas del inbox (`jdexInboxQueue`, `jdex-inbox-process.ts`) una a una, con cuatro
 * acciones por nota:
 *
 * - Mover: reutiliza el buscador de «Ir a un ID» (`jdex-id-picker.ts`), restringido a
 *   los IDs con carpeta — no hay dónde llevar la nota si no tiene una.
 * - Archivar: mismo criterio que retirar un ID (`archiveJdexInboxNote`).
 * - Omitir: pasa a la siguiente sin tocar la nota (se queda en el inbox real; volver
 *   a abrir «Procesar inbox» la trae otra vez).
 * - Abrir: como Omitir, y además abre la nota (`context.openNoteById`) para que se
 *   pueda mirar; el diálogo sigue con la siguiente en vez de cerrarse, para no cortar
 *   el recorrido por una sola nota.
 *
 * Se lanza desde ⌘K y al pulsar «Inbox: N» en la barra de estado (`jdex-runtime.ts`).
 */
import type { IdEntry } from './engine';
import { errorBanner } from './jdex-dialog-fields';
import { mountJdexIdPicker } from './jdex-id-picker';
import type { JdexNoteRef } from './library-index';

export interface JdexInboxProcessViewOptions {
  queue: readonly JdexNoteRef[];
  entries: readonly IdEntry[];
  /** Etiqueta legible del inbox de `note` («21.01 Bandeja de entrada»), para la
   *  cabecera de la fila activa. */
  folderLabel(note: JdexNoteRef): string;
  onMove(note: JdexNoteRef, entry: IdEntry): Promise<void>;
  /** Archive label when this inbox's category has a live `.09` folder. */
  archiveTarget?(note: JdexNoteRef): string | null;
  onArchive(note: JdexNoteRef): Promise<void>;
  onOpen(note: JdexNoteRef): void;
}

export function mountJdexInboxProcessView(
  el: HTMLElement,
  options: JdexInboxProcessViewOptions
): void {
  const queue = [...options.queue];

  const status = errorBanner();
  const noteView = document.createElement('div');
  const movePanel = document.createElement('div');
  movePanel.hidden = true;
  el.append(status, noteView, movePanel);

  function actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hebra-jdex-dialog-secondary hebra-jdex-goto-action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function advance(): void {
    queue.shift();
    movePanel.hidden = true;
    movePanel.replaceChildren();
    render();
  }

  function render(): void {
    status.textContent = '';
    noteView.replaceChildren();
    noteView.hidden = false;
    if (queue.length === 0) {
      const done = document.createElement('p');
      done.textContent = 'Bandeja de entrada procesada: no queda ninguna nota.';
      noteView.append(done);
      return;
    }
    const note = queue[0];
    const heading = document.createElement('p');
    heading.className = 'hebra-jdex-goto-heading';
    heading.textContent = note.title;
    const origin = document.createElement('p');
    origin.className = 'hebra-jdex-dialog-hint';
    origin.textContent = `${options.folderLabel(note)} — ${queue.length} nota(s) por procesar.`;

    const actions = document.createElement('div');
    actions.className = 'hebra-jdex-goto-actions';
    const target = options.archiveTarget ? options.archiveTarget(note) : '';
    const archive = actionButton(target ? `Archivar en ${target}` : 'Archivar', () => void runArchive(note));
    archive.disabled = target === null;
    if (target === null) archive.title = 'Esta categoría no tiene una carpeta .09.';
    actions.append(
      actionButton('Mover…', () => openMove(note)),
      archive,
      actionButton('Omitir', () => advance()),
      actionButton('Abrir', () => {
        options.onOpen(note);
        advance();
      })
    );
    noteView.append(heading, origin, actions);
  }

  function openMove(note: JdexNoteRef): void {
    noteView.hidden = true;
    movePanel.hidden = false;
    movePanel.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'hebra-jdex-goto-back';
    back.textContent = '‹ Cancelar mover';
    back.addEventListener('click', () => {
      movePanel.hidden = true;
      movePanel.replaceChildren();
      render();
    });
    movePanel.append(back);
    mountJdexIdPicker(movePanel, {
      entries: options.entries,
      filter: (entry) => entry.folderPath !== undefined,
      placeholder: 'Busca el ID de destino…',
      onSelect: (entry) => void runMove(note, entry)
    });
  }

  async function runMove(note: JdexNoteRef, entry: IdEntry): Promise<void> {
    status.textContent = '';
    try {
      await options.onMove(note, entry);
      advance();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function runArchive(note: JdexNoteRef): Promise<void> {
    status.textContent = '';
    try {
      await options.onArchive(note);
      advance();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  render();
}
