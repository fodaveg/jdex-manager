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
  onSelect(entry: IdEntry): void;
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

function normalize(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('es-ES');
}

export function mountJdexIdPicker(
  el: HTMLElement,
  options: JdexIdPickerOptions
): JdexIdPickerHandle {
  const root = document.createElement('div');
  root.className = 'hebra-jdex-id-picker';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'hebra-jdex-goto-search';
  search.placeholder = options.placeholder ?? 'Busca un ID por número o título…';
  search.setAttribute('aria-label', 'Buscar un ID');

  const list = document.createElement('ul');
  list.className = 'hebra-jdex-normalize-list hebra-jdex-goto-list';
  list.setAttribute('role', 'listbox');

  root.append(search, list);
  el.append(root);

  const pool = options.filter ? options.entries.filter((entry) => options.filter?.(entry) ?? true) : options.entries;

  function render(): void {
    const query = normalize(search.value.trim());
    list.replaceChildren();
    const filtered =
      query === ''
        ? pool
        : pool.filter(
            (entry) => normalize(entry.id).includes(query) || normalize(entry.label).includes(query)
          );
    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'hebra-jdex-goto-empty';
      empty.textContent = 'Ningún ID coincide.';
      list.append(empty);
      return;
    }
    const shown = filtered.slice(0, 200); // slice-seguro: array de entradas, no texto.
    for (const entry of shown) {
      const row = document.createElement('li');
      row.className = 'hebra-jdex-normalize-row hebra-jdex-goto-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.textContent = entry.label;
      button.addEventListener('click', () => options.onSelect(entry));
      row.append(button);
      list.append(row);
    }
  }

  search.addEventListener('input', render);
  render();
  return {
    root,
    focus: () => search.focus()
  };
}
