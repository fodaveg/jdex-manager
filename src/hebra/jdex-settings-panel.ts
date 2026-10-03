/**
 * Panel de Ajustes del módulo (tarea 1 del lote): carpeta JDex, raíz del sistema,
 * plantillas, informes e id de sistema opcional. Cada campo es texto (la ruta completa,
 * como la guarda el motor) con un botón «Elegir carpeta» sobre `host.pickFolder()`
 * (mismo selector que usa Tyrian). La autodetección (`00.00`/`00.02`/`00.03`) corre sola
 * en cada reconstrucción del índice (`jdex-runtime.ts`, `fillEmpty`): solo rellena lo que
 * está vacío, así que un campo escrito aquí a mano nunca se pisa sola.
 */
import type { JdexManagerSettings } from './engine';

export interface JdexSettingsPanelOptions {
  get(): JdexManagerSettings;
  /** Persiste y dispara la reconstrucción del índice. */
  save(next: JdexManagerSettings): void;
  /** `host.pickFolder()` traducido a ruta completa («» para la raíz o si se cancela). */
  pickFolder(): Promise<string>;
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

    const auto = document.createElement('p');
    auto.className = 'hebra-jdex-settings-hint';
    auto.textContent =
      'Vacío = se detecta solo (busca 00.00, 00.02 y 00.03 bajo la raíz del sistema).';
    container.append(auto);
  };
  refresh();
  el.append(container);
}
