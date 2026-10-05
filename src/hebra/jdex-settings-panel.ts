/**
 * Panel de Ajustes del módulo (tarea 1 del lote): carpeta JDex, raíz del sistema,
 * plantillas, informes e id de sistema opcional. Cada campo es texto (la ruta completa,
 * como la guarda el motor) con un botón «Elegir carpeta» sobre `host.pickFolder()`
 * (mismo selector que usa Tyrian). La autodetección (`00.00`/`00.02`/`00.03`) corre sola
 * en cada reconstrucción del índice (`jdex-runtime.ts`, `fillEmpty`): solo rellena lo que
 * está vacío, así que un campo escrito aquí a mano nunca se pisa sola.
 */
import { formatCategoryPatterns, parseCategoryPatterns, type JdexManagerSettings } from './engine';

export interface JdexSettingsPanelOptions {
  get(): JdexManagerSettings;
  /** Persiste y dispara la reconstrucción del índice. */
  save(next: JdexManagerSettings): void;
  /** `host.pickFolder()` traducido a ruta completa. `null` = no tocar el campo: la API
   *  devuelve `null` al cancelar y también al elegir «Raíz» (para la raíz se vacía el campo). */
  pickFolder(): Promise<string | null>;
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
  pick.addEventListener('click', () => {
    void options.pickFolder().then((path) => {
      if (path === null) return;
      input.value = path;
      commit();
    });
  });
  const hint = document.createElement('small');
  hint.textContent = spec.hint;
  row.append(label, input, pick, hint);
  return row;
}

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
    systemIdInput.addEventListener('change', () => {
      const current = options.get();
      if (current.systemId === systemIdInput.value) return;
      options.save({ ...current, systemId: systemIdInput.value });
    });
    systemIdRow.append(systemIdLabel, systemIdInput);
    container.append(systemIdRow);

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
