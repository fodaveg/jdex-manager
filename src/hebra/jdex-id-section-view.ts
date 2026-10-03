/**
 * DOM llano de la sección del ID (lote 4, tarea 2): ruta, descripción, ficheros de la
 * carpeta con su fecha, hijos («+», con un botón para crear el siguiente) y hermanos.
 * `jdex-id-section.ts` calcula los datos; este fichero solo pinta. Mismo patrón que
 * `jdex-audit-view.ts` (`mount(el, options): () => void`), montado por
 * `ui.registerView` con `placement: 'column'` (`jdex-runtime.ts`).
 */
import type { IdEntry } from './engine';
import type { JdexIdSectionData, JdexIdSectionFile } from './jdex-id-section';

export interface JdexIdSectionViewOptions {
  data: JdexIdSectionData;
  onGoto(entry: IdEntry): void;
  onOpenNote(id: string): void;
  onCreateChild(): void;
  /** `api.env.isoDates()`: el ajuste «Usar fechas ISO 8601» de Hebra, leído al pintar. */
  isoDates(): boolean;
}

const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-10-03` en hora local; vacío si la fecha no se entiende (el formato de
 *  `formatIsoDate` de Hebra: el ajuste se lee de la API, el formato se copia). */
function formatIsoDate(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(ms: number, iso: boolean): string {
  return iso ? formatIsoDate(ms) : DATE_FORMAT.format(new Date(ms));
}

/** Mientras `loadJdexIdSection` está en vuelo (la pestaña acaba de montarse o la nota
 *  activa acaba de cambiar). */
export function mountJdexIdSectionLoading(el: HTMLElement): void {
  el.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'hebra-jdex-section-empty';
  loading.setAttribute('role', 'status');
  loading.textContent = 'Cargando…';
  el.append(loading);
}

function fileRow(
  file: JdexIdSectionFile,
  onOpenNote: (id: string) => void,
  iso: boolean
): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'hebra-jdex-section-row';
  if (file.kind === 'note' && file.id !== undefined) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hebra-jdex-section-link';
    button.textContent = file.name;
    const id = file.id;
    button.addEventListener('click', () => onOpenNote(id));
    row.append(button);
  } else {
    const span = document.createElement('span');
    span.textContent = file.name;
    row.append(span);
  }
  const date = document.createElement('small');
  date.textContent = formatDate(file.date, iso);
  row.append(date);
  return row;
}

function entriesSection(
  title: string,
  entries: readonly IdEntry[],
  emptyText: string,
  onGoto: (entry: IdEntry) => void,
  extra?: HTMLElement
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'hebra-jdex-section-block';
  const heading = document.createElement('h3');
  heading.textContent = `${title} (${entries.length})`;
  section.append(heading);
  if (extra) section.append(extra);
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hebra-jdex-section-empty';
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }
  const list = document.createElement('ul');
  list.className = 'hebra-jdex-section-list';
  for (const entry of entries) {
    const row = document.createElement('li');
    row.className = 'hebra-jdex-section-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hebra-jdex-section-link';
    button.textContent = entry.label;
    button.addEventListener('click', () => onGoto(entry));
    row.append(button);
    list.append(row);
  }
  section.append(list);
  return section;
}

/** Monta el contenido y devuelve la limpieza. Se puede volver a llamar sobre el mismo
 *  `el` (la nota activa cambió mientras la pestaña seguía montada). */
export function mountJdexIdSectionView(
  el: HTMLElement,
  options: JdexIdSectionViewOptions
): () => void {
  el.replaceChildren();
  const { data } = options;
  if (!data.entry) {
    const empty = document.createElement('p');
    empty.className = 'hebra-jdex-section-empty';
    empty.textContent = 'Esta nota no vive en ningún ID del sistema JDex.';
    el.append(empty);
    return () => el.replaceChildren();
  }
  const entry = data.entry;

  const heading = document.createElement('p');
  heading.className = 'hebra-jdex-section-heading';
  heading.textContent = `${data.categoryLabel} › ${entry.label}`;
  el.append(heading);

  if (data.description !== '') {
    const description = document.createElement('p');
    description.className = 'hebra-jdex-section-description';
    description.textContent = data.description;
    el.append(description);
  }

  const filesSection = document.createElement('section');
  filesSection.className = 'hebra-jdex-section-block';
  const filesHeading = document.createElement('h3');
  filesHeading.textContent = `Ficheros de la carpeta (${data.files.length})`;
  filesSection.append(filesHeading);
  if (data.files.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hebra-jdex-section-empty';
    empty.textContent = entry.folderPath ? 'La carpeta está vacía.' : 'Este ID no tiene carpeta.';
    filesSection.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'hebra-jdex-section-list';
    const iso = options.isoDates();
    for (const file of data.files) list.append(fileRow(file, (id) => options.onOpenNote(id), iso));
    filesSection.append(list);
  }
  el.append(filesSection);

  const addChild = document.createElement('button');
  addChild.type = 'button';
  addChild.className = 'hebra-jdex-dialog-secondary hebra-jdex-section-add';
  addChild.textContent = '+ Crear hijo';
  addChild.addEventListener('click', () => options.onCreateChild());

  el.append(
    entriesSection('Hijos', data.children, 'Sin hijos.', (entry) => options.onGoto(entry), addChild),
    entriesSection('Hermanos', data.siblings, 'Sin más IDs en esta categoría.', (entry) => options.onGoto(entry))
  );

  return () => el.replaceChildren();
}
