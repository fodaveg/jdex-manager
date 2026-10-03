/**
 * Piezas de DOM llano compartidas por los diálogos de JDex (crear ID/categoría/área/
 * cabecera/hijo, normalizar frontmatter, envolver cabeceras): mismo patrón que
 * `jdex-settings-panel.ts` (fila con `<label>`), sin componente Svelte — los diálogos
 * se montan con `host.openModal(mount)` (`host-ui.ts`), que ya da el `<dialog>`, el
 * foco atrapado y Escape.
 */

export function textField(
  label: string,
  initial: string,
  onChange: (value: string) => void,
  placeholder = ''
): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'hebra-jdex-field';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(input.value));
  labelEl.append(input);
  row.append(labelEl);
  return { row, input };
}

export function selectField(
  label: string,
  options: readonly { value: string; label: string }[],
  initial: string,
  onChange: (value: string) => void
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'hebra-jdex-field';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const select = document.createElement('select');
  for (const option of options) {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.append(optionEl);
  }
  select.value = initial;
  select.addEventListener('change', () => onChange(select.value));
  labelEl.append(select);
  row.append(labelEl);
  return { row, select };
}

export function toggleField(
  label: string,
  hint: string,
  initial: boolean,
  onChange: (value: boolean) => void
): { row: HTMLElement; checkbox: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'hebra-jdex-field hebra-jdex-field-toggle';
  const labelEl = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = initial;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  labelEl.append(checkbox, document.createTextNode(label));
  row.append(labelEl);
  if (hint !== '') {
    const hintEl = document.createElement('small');
    hintEl.textContent = hint;
    row.append(hintEl);
  }
  return { row, checkbox };
}

/** Mensaje de validación en vivo (`refreshValidation` del plugin de Obsidian): vacío
 *  cuando no hay error. */
export function errorBanner(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'hebra-jdex-dialog-error';
  el.setAttribute('role', 'alert');
  return el;
}

export function primaryButton(text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hebra-jdex-dialog-primary';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

/** Enter en cualquier campo del diálogo dispara `submit()`, como en el plugin de
 *  Obsidian, salvo que el foco esté en un botón deshabilitado. */
export function submitOnEnter(
  container: HTMLElement,
  canSubmit: () => boolean,
  submit: () => void
): void {
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!canSubmit()) return;
    event.preventDefault();
    submit();
  });
}
