/**
 * Buscador + lista de IDs, compartido por «JDex: ir a un ID» (`jdex-goto-view.ts`) y
 * «Procesar inbox» (`jdex-inbox-process-view.ts`, mover una nota a un ID): filtra en
 * memoria sobre `id`/`label` — la lista ya la tiene el runtime (`index.ids`), sin
 * consulta nueva. Extraído del selector de «ir a un ID» (lote 3) para que «Procesar
 * inbox» (lote 4) reutilice EXACTAMENTE el mismo buscador, como pide el encargo.
 */
import type { IdEntry } from './engine';

export interface JdexIdPickerOptions {
  entries: readonly IdEntry[];
  /** Pulsar una fila (clic, o Enter con el foco en ella). */
  onSelect(entry: IdEntry): void;
  /** Enter en el buscador sobre la fila resaltada. Sin ella, lo mismo que `onSelect`. */
  onActivate?(entry: IdEntry): void;
  /** Restringe la lista antes de buscar (p. ej. «solo IDs con carpeta», al mover una
   *  nota del inbox: no hay dónde llevarla si no tiene una). Sin ella, todas. */
  filter?(entry: IdEntry): boolean;
  placeholder?: string;
}

export interface JdexIdPickerHandle {
  /** Contenedor de todo el buscador (input + lista): quien lo monta lo usa para
   *  ocultarlo o retirarlo sin tener que conocer su estructura interna. */
  root: HTMLElement;
  focus(): void;
}

/** Filas que se pintan como máximo; el resto se avisa con «Se muestran N de M». */
const SHOWN_LIMIT = 200;
let pickerCounter = 0;

function normalize(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('es-ES');
}

export function mountJdexIdPicker(
  el: HTMLElement,
  options: JdexIdPickerOptions
): JdexIdPickerHandle {
  const root = el.ownerDocument.createElement('div');
  root.className = 'hebra-jdex-id-picker';
  pickerCounter += 1;
  const listId = `hebra-jdex-id-picker-${pickerCounter}`;

  const search = el.ownerDocument.createElement('input');
  search.type = 'search';
  search.className = 'hebra-jdex-goto-search';
  search.placeholder = options.placeholder ?? 'Busca un ID por número o título…';
  search.setAttribute('aria-label', 'Buscar un ID');
  // Combobox con la lista como popup: el foco se queda en el buscador y el resaltado
  // lo anuncia `aria-activedescendant`; las flechas lo mueven y Enter abre el resaltado.
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'true');
  search.setAttribute('aria-controls', listId);

  const list = el.ownerDocument.createElement('ul');
  list.id = listId;
  list.className = 'hebra-jdex-normalize-list hebra-jdex-goto-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'IDs');

  const status = el.ownerDocument.createElement('p');
  status.className = 'hebra-jdex-goto-status';
  status.setAttribute('role', 'status');

  root.append(search, list, status);
  el.append(root);

  const pool = options.filter ? options.entries.filter((entry) => options.filter?.(entry) ?? true) : options.entries;
  let shown: IdEntry[] = [];
  let active = 0;

  function paintActive(): void {
    const buttons = list.querySelectorAll<HTMLElement>('[role="option"]');
    buttons.forEach((button, i) => {
      const on = i === active;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.classList.toggle('is-active', on);
      if (on) {
        search.setAttribute('aria-activedescendant', button.id);
        if (typeof button.scrollIntoView === 'function') button.scrollIntoView({ block: 'nearest' });
      }
    });
    if (buttons.length === 0) search.removeAttribute('aria-activedescendant');
  }

  function render(): void {
    const query = normalize(search.value.trim());
    list.replaceChildren();
    const filtered =
      query === ''
        ? pool
        : pool.filter(
            (entry) => normalize(entry.id).includes(query) || normalize(entry.label).includes(query)
          );
    shown = [];
    active = 0;
    if (filtered.length === 0) {
      const empty = el.ownerDocument.createElement('li');
      empty.className = 'hebra-jdex-goto-empty';
      empty.setAttribute('role', 'none');
      empty.textContent = 'Ningún ID coincide.';
      list.append(empty);
      status.textContent = 'Ningún ID coincide.';
      paintActive();
      return;
    }
    shown = filtered.slice(0, SHOWN_LIMIT); // slice-seguro: array de entradas, no texto.
    shown.forEach((entry, i) => {
      const row = el.ownerDocument.createElement('li');
      row.className = 'hebra-jdex-normalize-row hebra-jdex-goto-row';
      row.setAttribute('role', 'none');
      const button = el.ownerDocument.createElement('button');
      button.type = 'button';
      button.id = `${listId}-${i}`;
      button.setAttribute('role', 'option');
      button.textContent = entry.label;
      button.addEventListener('click', () => options.onSelect(entry));
      row.append(button);
      list.append(row);
    });
    status.textContent =
      filtered.length > shown.length
        ? `Se muestran ${shown.length} de ${filtered.length}: afina la búsqueda.`
        : `${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}.`;
    paintActive();
  }

  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (shown.length === 0) return;
      event.preventDefault();
      active = event.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
      paintActive();
    } else if (event.key === 'Enter' && !event.isComposing) {
      const entry = shown[active];
      if (!entry) return;
      event.preventDefault();
      (options.onActivate ?? options.onSelect)(entry);
    }
  });
  render();
  return {
    root,
    focus: () => search.focus()
  };
}
