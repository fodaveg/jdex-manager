/**
 * Panel de Ajustes del módulo (tarea 1 del lote): carpeta JDex, raíz del sistema,
 * plantillas, informes e id de sistema opcional. Cada campo es texto (la ruta completa,
 * como la guarda el motor) con un botón «Elegir carpeta» sobre `host.pickFolder()`
 * (mismo selector que usa Tyrian). La autodetección (`00.00`/`00.02`/`00.03`) corre sola
 * en cada reconstrucción del índice (`jdex-runtime.ts`, `fillEmpty`): solo rellena lo que
 * está vacío, así que un campo escrito aquí a mano nunca se pisa sola.
 */
import { formatCategoryPatterns, normalizeSystemId, parseCategoryPatterns, type JdexManagerSettings } from './engine';

export interface JdexSettingsPanelOptions {
  get(): JdexManagerSettings;
  /** Persiste y dispara la reconstrucción del índice. */
  save(next: JdexManagerSettings): void;
  /** `host.pickFolder()` traducido a ruta completa. `null` = no tocar el campo: la API
   *  devuelve `null` al cancelar y también al elegir «Raíz» (para la raíz se vacía el campo). */
  pickFolder(): Promise<string | null>;
  /** «Escribir plantillas integradas»: writes the missing ones and returns the message to
   *  show (or throws with it). Absent = no button. */
  writeTemplates?(): Promise<string>;
}

interface FieldSpec {
  key: 'jdexFolder' | 'systemRoot' | 'templatesFolder' | 'reportsFolder';
  label: string;
  hint: string;
}

const FOLDER_FIELDS: readonly FieldSpec[] = [
  { key: 'systemRoot', label: 'Raíz del sistema', hint: 'Vacío = toda la biblioteca.' },
  { key: 'jdexFolder', label: 'Carpeta JDex', hint: 'Una nota por ID (el 00.00 del sistema).' },
  { key: 'templatesFolder', label: 'Plantillas', hint: 'El 00.03 del sistema.' },
  { key: 'reportsFolder', label: 'Informes', hint: 'El 00.02 del sistema, para las auditorías.' }
];

function folderField(
  spec: FieldSpec,
  options: JdexSettingsPanelOptions,
  onChange: () => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hebra-jdex-settings-row';
  const label = document.createElement('label');
  label.textContent = spec.label;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = fieldId(spec.key);
  label.htmlFor = input.id;
  input.value = options.get()[spec.key];
  input.placeholder = 'Sin configurar';
  const commit = (): void => {
    const current = options.get();
    if (current[spec.key] === input.value) return;
    options.save({ ...current, [spec.key]: input.value });
    onChange();
  };
  input.addEventListener('change', commit);
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.textContent = 'Elegir carpeta…';
  pick.setAttribute('aria-label', `Elegir carpeta: ${spec.label}`);
  pick.addEventListener('click', () => {
    void options.pickFolder().then((path) => {
      if (path === null) return;
      input.value = path;
      commit();
    });
  });
  const hint = document.createElement('small');
  hint.textContent = spec.hint;
  hint.id = `${input.id}-hint`;
  input.setAttribute('aria-describedby', hint.id);
  row.append(label, input, pick, hint);
  return row;
}

/** Unique ids for `<label for>` and `aria-describedby`: the panel can be mounted twice. */
let fieldSerial = 0;
function fieldId(name: string): string {
  fieldSerial += 1;
  return `hebra-jdex-setting-${name}-${fieldSerial}`;
}

/** A labelled control: the input nested in its `<label>`, so it has an accessible name. */
function labelledRow(text: string, control: HTMLElement, controlFirst = false): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'hebra-jdex-settings-row';
  if (controlFirst) row.append(control, document.createTextNode(text));
  else row.append(document.createTextNode(text), control);
  return row;
}

const TEMPLATE_LABELS: readonly [keyof JdexManagerSettings['templateNames'], string][] = [
  ['id', 'Nombre de la plantilla de ID'],
  ['cabecera', 'Nombre de la plantilla de cabecera'],
  ['categoria', 'Nombre de la plantilla de categoría'],
  ['area', 'Nombre de la plantilla de área']
];

const EXTRA_TOGGLES: readonly [string, 'createFolderByDefault' | 'descriptionIsFinding' | 'noteWithoutFolderIsFinding' | 'renamePairsWithoutAsking'][] = [
  ['Crear también la carpeta al crear (valor inicial de la casilla)', 'createFolderByDefault'],
  ['Avisar de notas JDex sin descripción', 'descriptionIsFinding'],
  ['Contar como problema una nota JDex sin carpeta', 'noteWithoutFolderIsFinding'],
  ['Renombrar la pareja nota y carpeta sin preguntar', 'renamePairsWithoutAsking']
];

export function mountJdexSettingsPanel(el: HTMLElement, options: JdexSettingsPanelOptions): void {
  const container = document.createElement('div');
  container.className = 'hebra-jdex-settings';

  const refresh = (): void => {
    container.replaceChildren();
    for (const spec of FOLDER_FIELDS) container.append(folderField(spec, options, refresh));

    const systemIdRow = document.createElement('div');
    systemIdRow.className = 'hebra-jdex-settings-row';
    const systemIdLabel = document.createElement('label');
    systemIdLabel.textContent = 'Id de sistema (opcional)';
    const systemIdInput = document.createElement('input');
    systemIdInput.type = 'text';
    systemIdInput.value = options.get().systemId;
    systemIdInput.placeholder = 'D01, con varios sistemas en la misma biblioteca';
    systemIdInput.id = fieldId('systemId');
    systemIdLabel.htmlFor = systemIdInput.id;
    const systemIdError = document.createElement('small');
    systemIdError.className = 'hebra-jdex-settings-error';
    systemIdError.setAttribute('role', 'alert');
    systemIdError.id = `${systemIdInput.id}-error`;
    systemIdInput.setAttribute('aria-describedby', systemIdError.id);
    systemIdInput.addEventListener('change', () => {
      const current = options.get();
      // Same rule as the Obsidian plugin (`normalizeSystemId`): a capital letter and two
      // digits, or empty. Anything else is rejected and the stored value stays.
      const normalized = normalizeSystemId(systemIdInput.value);
      if (normalized === null) {
        systemIdError.textContent = `«${systemIdInput.value.trim()}» no es un id de sistema: una letra y dos cifras, como D01.`;
        systemIdInput.setAttribute('aria-invalid', 'true');
        systemIdInput.value = current.systemId;
        return;
      }
      systemIdError.textContent = '';
      systemIdInput.removeAttribute('aria-invalid');
      systemIdInput.value = normalized;
      if (current.systemId === normalized) return;
      options.save({ ...current, systemId: normalized });
    });
    systemIdRow.append(systemIdLabel, systemIdInput, systemIdError);
    container.append(systemIdRow);
    const prefixRow = document.createElement('label');
    prefixRow.className = 'hebra-jdex-settings-row';
    const prefixInput = document.createElement('input');
    prefixInput.type = 'checkbox';
    prefixInput.checked = options.get().prefixNamesWithSystem;
    prefixInput.addEventListener('change', () => options.save({ ...options.get(), prefixNamesWithSystem: prefixInput.checked }));
    prefixRow.append(prefixInput, document.createTextNode('Poner el id de sistema delante de los nombres nuevos (D01.21.22 Título)'));
    container.append(prefixRow);

    for (const [labelText, value, save] of [
      ['Patrón de subcarpetas', options.get().subfolderPattern, (value: string) => options.save({ ...options.get(), subfolderPattern: value })],
      ['Patrones por categoría', formatCategoryPatterns(options.get().subfolderPatternsByCategory), (value: string) => options.save({ ...options.get(), subfolderPatternsByCategory: parseCategoryPatterns(value) })],
      ['Nota del índice del sistema', options.get().systemIndexNote, (value: string) => options.save({ ...options.get(), systemIndexNote: value })]
    ] as const) {
      const row = document.createElement('label');
      row.className = 'hebra-jdex-settings-row';
      row.append(document.createTextNode(labelText));
      const input = document.createElement('textarea');
      input.value = value;
      input.addEventListener('change', () => save(input.value));
      row.append(input);
      container.append(row);
    }
    for (const [labelText, key] of [['Crear patrón por defecto', 'createPatternByDefault'], ['Cabeceras vivas', 'liveHeaders'], ['Mantenimiento automático', 'automaticMaintenance'], ['Avisar de áreas y categorías sin nota', 'structureNotesAreFindings']] as const) {
      const row = document.createElement('label');
      row.className = 'hebra-jdex-settings-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = options.get()[key];
      input.addEventListener('change', () => options.save({ ...options.get(), [key]: input.checked }));
      row.append(input, document.createTextNode(labelText));
      container.append(row);
    }
    for (const [labelText, key] of EXTRA_TOGGLES) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = options.get()[key];
      input.addEventListener('change', () => options.save({ ...options.get(), [key]: input.checked }));
      container.append(labelledRow(labelText, input, true));
    }
    for (const [type, labelText] of TEMPLATE_LABELS) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = options.get().templateNames[type];
      input.addEventListener('change', () => {
        const current = options.get();
        const name = input.value.trim();
        // A template needs a name: empty restores the stored one.
        if (name === '') { input.value = current.templateNames[type]; return; }
        if (name === current.templateNames[type]) return;
        options.save({ ...current, templateNames: { ...current.templateNames, [type]: name } });
      });
      container.append(labelledRow(labelText, input));
    }
    if (options.writeTemplates) {
      const writeTemplates = (): Promise<string> => options.writeTemplates!();
      const templatesRow = document.createElement('div');
      templatesRow.className = 'hebra-jdex-settings-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Escribir plantillas integradas';
      const status = document.createElement('small');
      status.setAttribute('role', 'status');
      status.id = fieldId('templates-status');
      button.setAttribute('aria-describedby', status.id);
      button.addEventListener('click', () => {
        button.disabled = true;
        void writeTemplates()
          .then((message) => { status.textContent = message; })
          .catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); })
          .finally(() => { button.disabled = false; });
      });
      templatesRow.append(button, status);
      container.append(templatesRow);
    }
    const healthMax = document.createElement('input');
    healthMax.type = 'number';
    healthMax.min = '0';
    healthMax.step = '1';
    healthMax.value = String(options.get().healthMaxFiles);
    healthMax.addEventListener('change', () => {
      const value = Number(healthMax.value);
      if (!Number.isInteger(value) || value < 0) { healthMax.value = String(options.get().healthMaxFiles); return; }
      options.save({ ...options.get(), healthMaxFiles: value });
    });
    container.append(labelledRow('Ficheros por ID a partir de los que el informe de salud avisa', healthMax));
    const dateRow = document.createElement('label');
    dateRow.className = 'hebra-jdex-settings-row';
    dateRow.append(document.createTextNode('Formato de fecha al archivar'));
    const dateFormat = document.createElement('select');
    for (const format of ['YYYY-MM-DD', 'YYYY-MM'] as const) {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = format;
      dateFormat.append(option);
    }
    dateFormat.value = options.get().dateFormat;
    dateFormat.addEventListener('change', () => {
      if (dateFormat.value === 'YYYY-MM-DD' || dateFormat.value === 'YYYY-MM') options.save({ ...options.get(), dateFormat: dateFormat.value });
    });
    dateRow.append(dateFormat);
    container.append(dateRow);
    const staleRow = document.createElement('label');
    staleRow.className = 'hebra-jdex-settings-row';
    staleRow.append(document.createTextNode('Días para inbox antiguo'));
    const staleDays = document.createElement('input');
    staleDays.type = 'number';
    staleDays.min = '1';
    staleDays.step = '1';
    staleDays.value = String(options.get().inboxStaleDays);
    staleDays.addEventListener('change', () => {
      const days = Number(staleDays.value);
      if (!Number.isInteger(days) || days < 1) { staleDays.value = String(options.get().inboxStaleDays); return; }
      options.save({ ...options.get(), inboxStaleDays: days });
    });
    staleRow.append(staleDays);
    container.append(staleRow);

    const auto = document.createElement('p');
    auto.className = 'hebra-jdex-settings-hint';
    auto.textContent =
      'Vacío = se detecta solo (busca 00.00, 00.02 y 00.03 bajo la raíz del sistema).';
    container.append(auto);
  };
  refresh();
  el.append(container);
}
