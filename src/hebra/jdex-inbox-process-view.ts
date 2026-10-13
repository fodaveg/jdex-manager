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
 *   el recorrido por una sola nota. DECISIÓN (audit 12 oct 2026, finding 11): se
 *   mantiene así; en Obsidian el diálogo se cierra porque su modal tapa la nota.
 * - Papelera (audit 12 oct 2026): con confirmación; la nota se recupera de la papelera
 *   de Hebra o con «deshacer».
 * - Vista previa: los primeros 600 caracteres de la nota, como en Obsidian.
 * - Mover a un ID sin carpeta: solo si el usuario marca «Incluir IDs sin carpeta» y
 *   confirma; nunca se crea una carpeta sin que lo pida.
 * Hebra NO fecha el nombre al mover (Obsidian tiene el ajuste `dateOnMove`); solo
 * «Archivar» pone la fecha de creación delante.
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
  /** First characters of the note body; `null` when it cannot be read (protected note). */
  readPreview?(note: JdexNoteRef): Promise<string | null>;
  /** Send the note to the library trash. Without it the button is not shown. */
  onTrash?(note: JdexNoteRef): Promise<void>;
  /** Move to an ID that has no folder, creating it. Without it only IDs with a folder are offered. */
  onMoveCreatingFolder?(note: JdexNoteRef, entry: IdEntry): Promise<void>;
}

export const JDEX_INBOX_PREVIEW_CHARS = 600;

export function mountJdexInboxProcessView(
  el: HTMLElement,
  options: JdexInboxProcessViewOptions
): void {
  const queue = [...options.queue];

  const status = errorBanner(el.ownerDocument, );
  const noteView = el.ownerDocument.createElement('div');
  const movePanel = el.ownerDocument.createElement('div');
  movePanel.hidden = true;
  el.append(status, noteView, movePanel);

  function actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = el.ownerDocument.createElement('button');
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
      const done = el.ownerDocument.createElement('p');
      done.textContent = 'Bandeja de entrada procesada: no queda ninguna nota.';
      noteView.append(done);
      return;
    }
    const note = queue[0];
    const heading = el.ownerDocument.createElement('p');
    heading.className = 'hebra-jdex-goto-heading';
    heading.textContent = note.title;
    const origin = el.ownerDocument.createElement('p');
    origin.className = 'hebra-jdex-dialog-hint';
    origin.textContent = `${options.folderLabel(note)} — ${queue.length} nota(s) por procesar.`;

    const actions = el.ownerDocument.createElement('div');
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
    if (options.onTrash) actions.append(actionButton('Papelera…', () => confirmTrash(note)));
    noteView.append(heading, origin);
    if (options.readPreview) {
      const preview = el.ownerDocument.createElement('pre');
      preview.className = 'hebra-jdex-inbox-preview';
      preview.setAttribute('aria-label', 'Vista previa de la nota');
      preview.textContent = 'Cargando…';
      noteView.append(preview);
      void options.readPreview(note).then(
        (text) => {
          if (queue[0] !== note) return;
          preview.textContent =
            text === null
              ? 'No se puede mostrar una vista previa de esta nota.'
              : text === ''
                ? '(nota vacía)'
                : text.length > JDEX_INBOX_PREVIEW_CHARS
                  ? `${text.slice(0, JDEX_INBOX_PREVIEW_CHARS)}…`
                  : text;
        },
        () => {
          if (queue[0] === note) preview.textContent = 'No se pudo leer la nota.';
        }
      );
    }
    noteView.append(actions);
  }

  /** Inline confirmation: nothing is trashed by a single click. */
  function confirmTrash(note: JdexNoteRef): void {
    noteView.replaceChildren();
    const message = el.ownerDocument.createElement('p');
    message.textContent = `«${note.title}» irá a la papelera de Hebra. Podrás recuperarla desde ella o con «deshacer».`;
    const actions = el.ownerDocument.createElement('div');
    actions.className = 'hebra-jdex-goto-actions';
    const confirm = el.ownerDocument.createElement('button');
    confirm.type = 'button';
    confirm.className = 'hebra-jdex-dialog-primary';
    confirm.textContent = 'Mandar a la papelera';
    confirm.addEventListener('click', () => void runTrash(note));
    actions.append(confirm, actionButton('Cancelar', () => render()));
    noteView.append(message, actions);
    confirm.focus();
  }

  async function runTrash(note: JdexNoteRef): Promise<void> {
    status.textContent = '';
    try {
      await options.onTrash?.(note);
      advance();
    } catch (error) {
      render();
      status.textContent = pluginErrorMessage(error);
    }
  }

  function openMove(note: JdexNoteRef): void {
    noteView.hidden = true;
    movePanel.hidden = false;
    movePanel.replaceChildren();
    const back = el.ownerDocument.createElement('button');
    back.type = 'button';
    back.className = 'hebra-jdex-goto-back';
    back.textContent = '‹ Cancelar mover';
    back.addEventListener('click', () => {
      movePanel.hidden = true;
      movePanel.replaceChildren();
      render();
    });
    movePanel.append(back);
    const pickerHost = el.ownerDocument.createElement('div');
    let includeWithoutFolder = false;
    const mountPicker = (): void => {
      pickerHost.replaceChildren();
      mountJdexIdPicker(pickerHost, {
        entries: options.entries,
        filter: (entry) => includeWithoutFolder || entry.folderPath !== undefined,
        placeholder: 'Busca el ID de destino…',
        onSelect: (entry) =>
          entry.folderPath === undefined ? confirmCreateFolder(note, entry) : void runMove(note, entry)
      });
    };
    if (options.onMoveCreatingFolder) {
      const label = el.ownerDocument.createElement('label');
      label.className = 'hebra-jdex-inbox-optional';
      const toggle = el.ownerDocument.createElement('input');
      toggle.type = 'checkbox';
      toggle.addEventListener('change', () => {
        includeWithoutFolder = toggle.checked;
        mountPicker();
      });
      label.append(toggle, ' Incluir IDs sin carpeta (la carpeta solo se crea si lo confirmas)');
      movePanel.append(label);
    }
    movePanel.append(pickerHost);
    mountPicker();
  }

  /** A destination ID without a folder: ask before creating it. */
  function confirmCreateFolder(note: JdexNoteRef, entry: IdEntry): void {
    movePanel.replaceChildren();
    const message = el.ownerDocument.createElement('p');
    message.textContent = `«${entry.label}» no tiene carpeta. ¿Crearla y mover «${note.title}» ahí?`;
    const actions = el.ownerDocument.createElement('div');
    actions.className = 'hebra-jdex-goto-actions';
    const confirm = el.ownerDocument.createElement('button');
    confirm.type = 'button';
    confirm.className = 'hebra-jdex-dialog-primary';
    confirm.textContent = 'Crear carpeta y mover';
    confirm.addEventListener('click', () => void runMoveCreating(note, entry));
    actions.append(confirm, actionButton('Cancelar', () => openMove(note)));
    movePanel.append(message, actions);
    confirm.focus();
  }

  async function runMoveCreating(note: JdexNoteRef, entry: IdEntry): Promise<void> {
    status.textContent = '';
    try {
      await options.onMoveCreatingFolder?.(note, entry);
      advance();
    } catch (error) {
      status.textContent = pluginErrorMessage(error);
      openMove(note);
    }
  }

  async function runMove(note: JdexNoteRef, entry: IdEntry): Promise<void> {
    status.textContent = '';
    try {
      await options.onMove(note, entry);
      advance();
    } catch (error) {
      status.textContent = pluginErrorMessage(error);
    }
  }

  async function runArchive(note: JdexNoteRef): Promise<void> {
    status.textContent = '';
    try {
      await options.onArchive(note);
      advance();
    } catch (error) {
      status.textContent = pluginErrorMessage(error);
    }
  }

  render();
}
import { pluginErrorMessage } from './error-message';
