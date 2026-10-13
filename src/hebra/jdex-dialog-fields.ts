/**
 * Piezas de DOM llano compartidas por los diálogos de JDex (crear ID/categoría/área/
 * cabecera/hijo, normalizar frontmatter, envolver cabeceras): mismo patrón que
 * `jdex-settings-panel.ts` (fila con `<label>`), sin componente Svelte — los diálogos
 * se montan con `host.openModal(mount)` (`host-ui.ts`), que ya da el `<dialog>`, el
 * foco atrapado y Escape.
 */

export function textField(
  doc: Document,
  label: string,
  initial: string,
  onChange: (value: string) => void,
  placeholder = ''
): { row: HTMLElement; input: HTMLInputElement } {
  const row = doc.createElement('div');
  row.className = 'hebra-jdex-field';
  const labelEl = doc.createElement('label');
  labelEl.textContent = label;
  const input = doc.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(input.value));
  labelEl.append(input);
  row.append(labelEl);
  return { row, input };
}

export function selectField(
  doc: Document,
  label: string,
  options: readonly { value: string; label: string }[],
  initial: string,
  onChange: (value: string) => void
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = doc.createElement('div');
  row.className = 'hebra-jdex-field';
  const labelEl = doc.createElement('label');
  labelEl.textContent = label;
  const select = doc.createElement('select');
  for (const option of options) {
    const optionEl = doc.createElement('option');
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
  doc: Document,
  label: string,
  hint: string,
  initial: boolean,
  onChange: (value: boolean) => void
): { row: HTMLElement; checkbox: HTMLInputElement } {
  const row = doc.createElement('div');
  row.className = 'hebra-jdex-field hebra-jdex-field-toggle';
  const labelEl = doc.createElement('label');
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = initial;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  labelEl.append(checkbox, doc.createTextNode(label));
  row.append(labelEl);
  if (hint !== '') {
    const hintEl = doc.createElement('small');
    hintEl.textContent = hint;
    row.append(hintEl);
  }
  return { row, checkbox };
}

/** Mensaje de validación en vivo (`refreshValidation` del plugin de Obsidian): vacío
 *  cuando no hay error. */
export function errorBanner(doc: Document): HTMLElement {
  const el = doc.createElement('p');
  el.className = 'hebra-jdex-dialog-error';
  el.setAttribute('role', 'alert');
  return el;
}

export function primaryButton(doc: Document, text: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
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
