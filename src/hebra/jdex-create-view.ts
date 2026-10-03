/**
 * Diálogos de «crear ID / categoría / área / cabecera / hijo (+)» (tarea 1 del lote,
 * 28 sep 2026): un diálogo por comando de paleta, montado con `host.openModal` (el
 * `<dialog>` nativo de `host-ui.ts`, con foco atrapado y Escape ya resueltos). Cada uno
 * propone el siguiente número libre (`nextFreeId`, `nextFreeCategory`, `nextFreeArea`,
 * `nextFreeHeader`), pide el título, valida en vivo (mismo criterio que
 * `CreateIdModal.refreshValidation` del plugin de Obsidian, reimplementado sin
 * `obsidian` en `./jdex-create.ts`) y solo entonces habilita «Crear».
 */
import {
  areaCode,
  nextFreeArea,
  nextFreeCategory,
  nextFreeHeader,
  nextFreeId,
  knownIds,
  type AreaEntry,
  type CategoryEntry,
  type IdEntry,
  type JdIndex
} from './engine';
import {
  requireTitle,
  validateNewChildTitle,
  validateNewHeader,
  validateNewId
} from './jdex-create';
import {
  errorBanner,
  primaryButton,
  selectField,
  submitOnEnter,
  textField,
  toggleField
} from './jdex-dialog-fields';
import type {
  CreateAreaRequest,
  CreateCategoryRequest,
  CreateChildRequest,
  CreateHeaderRequest,
  CreateIdRequest
} from './jdex-create-write';

/** Foco en el primer campo, como `window.setTimeout(() => text.inputEl.focus(), 0)`
 *  del plugin de Obsidian (el `<dialog>` aún no ha terminado de abrirse cuando se
 *  monta el contenido). */
function focusFirst(container: HTMLElement): void {
  window.setTimeout(() => container.querySelector<HTMLElement>('input, select')?.focus(), 0);
}

// ---- Crear ID ---------------------------------------------------------------------

export interface CreateIdDialogOptions {
  index: JdIndex;
  categories: readonly CategoryEntry[];
  createFolderDefault: boolean;
  onSubmit(request: CreateIdRequest): Promise<void>;
}

export function mountCreateIdDialog(el: HTMLElement, options: CreateIdDialogOptions): void {
  const heading = document.createElement('p');
  el.append(heading);
  let category = options.categories[0];
  let id = category ? (nextFreeId(category.number, knownIds(options.index)) ?? '') : '';
  let title = '';
  let createFolder = options.createFolderDefault;

  const categoryField = selectField(
    'Categoría',
    options.categories.map((c) => ({ value: c.number, label: c.label })),
    category?.number ?? '',
    (value) => {
      const next = options.categories.find((c) => c.number === value);
      if (!next) return;
      category = next;
      id = nextFreeId(category.number, knownIds(options.index)) ?? '';
      idField.input.value = id;
      refresh();
    }
  );
  const idField = textField('Número', id, (value) => {
    id = value.trim();
    refresh();
  });
  const titleField = textField('Título', title, (value) => {
    title = value;
    refresh();
  });
  const { row: folderRow } = toggleField(
    'Crear también la carpeta',
    'Dentro de la carpeta de la categoría en la raíz del sistema.',
    createFolder,
    (value) => (createFolder = value)
  );
  const error = errorBanner();
  const submit = primaryButton('Crear', () => void trySubmit());

  el.append(categoryField.row, idField.row, titleField.row, folderRow, error, submit);
  focusFirst(el);
  submitOnEnter(
    el,
    () => !submit.disabled,
    () => void trySubmit()
  );

  function currentError(): string | null {
    if (!category) return 'No hay ninguna categoría en el sistema.';
    const idError = validateNewId(options.index, category.number, id);
    if (idError) return idError;
    return requireTitle(title);
  }

  function refresh(): void {
    const err = currentError();
    error.textContent = err ?? '';
    submit.disabled = err !== null;
  }

  async function trySubmit(): Promise<void> {
    if (currentError() !== null || !category) return;
    await options.onSubmit({ category, id, title, createFolder });
  }

  refresh();
}

// ---- Crear categoría ----------------------------------------------------------------

export interface CreateCategoryDialogOptions {
  index: JdIndex;
  areas: readonly AreaEntry[];
  createFolderDefault: boolean;
  onSubmit(request: CreateCategoryRequest): Promise<void>;
}

export function mountCreateCategoryDialog(
  el: HTMLElement,
  options: CreateCategoryDialogOptions
): void {
  let area = options.areas[0];
  let number = area
    ? (nextFreeCategory(
        area.number,
        options.index.categories.map((c) => c.number)
      ) ?? '')
    : '';
  let title = '';
  let createFolder = options.createFolderDefault;
  let createInbox = true;
  let createArchive = true;

  const areaField = selectField(
    'Área',
    options.areas.map((a) => ({ value: String(a.number), label: a.label })),
    area ? String(area.number) : '',
    (value) => {
      const next = options.areas.find((a) => a.number === Number(value));
      if (!next) return;
      area = next;
      number =
        nextFreeCategory(
          area.number,
          options.index.categories.map((c) => c.number)
        ) ?? '';
      numberField.input.value = number;
      refresh();
    }
  );
  const numberField = textField('Número', number, (value) => {
    number = value.trim();
    refresh();
  });
  const titleField = textField('Título', title, (value) => {
    title = value;
    refresh();
  });
  const { row: folderRow } = toggleField(
    'Crear también la carpeta',
    'Dentro de la carpeta del área en la raíz del sistema.',
    createFolder,
    (value) => (createFolder = value)
  );
  const { row: inboxRow } = toggleField(
    'Crear el inbox (.01)',
    '',
    createInbox,
    (v) => (createInbox = v)
  );
  const { row: archiveRow } = toggleField(
    'Crear el archivo (.09)',
    '',
    createArchive,
    (v) => (createArchive = v)
  );
  const error = errorBanner();
  const submit = primaryButton('Crear', () => void trySubmit());

  el.append(
    areaField.row,
    numberField.row,
    titleField.row,
    folderRow,
    inboxRow,
    archiveRow,
    error,
    submit
  );
  focusFirst(el);
  submitOnEnter(
    el,
    () => !submit.disabled,
    () => void trySubmit()
  );

  function currentError(): string | null {
    if (!area) return 'No hay ninguna área en el sistema.';
    const numberError = validateNumber();
    if (numberError) return numberError;
    return requireTitle(title);
  }

  function validateNumber(): string | null {
    if (!area) return null;
    const value = Number(number);
    if (!/^\d{2}$/.test(number)) return 'Escribe una categoría de dos dígitos, como 22.';
    if (value < area.number || value > area.number + 9)
      return `La categoría tiene que estar dentro de ${areaCode(area.number)}.`;
    if (value === area.number) return `${number} es la categoría de gestión del área.`;
    if (options.index.categories.some((c) => c.number === number)) return `${number} ya existe.`;
    return null;
  }

  function refresh(): void {
    const err = currentError();
    error.textContent = err ?? '';
    submit.disabled = err !== null;
  }

  async function trySubmit(): Promise<void> {
    if (currentError() !== null || !area) return;
    await options.onSubmit({
      area,
      category: number,
      title,
      createFolder,
      createInbox,
      createArchive
    });
  }

  refresh();
}

// ---- Crear área ---------------------------------------------------------------------

export interface CreateAreaDialogOptions {
  index: JdIndex;
  createFolderDefault: boolean;
  onSubmit(request: CreateAreaRequest): Promise<void>;
}

export function mountCreateAreaDialog(el: HTMLElement, options: CreateAreaDialogOptions): void {
  const next = nextFreeArea(options.index);
  let numberText = next === null ? '' : areaCode(next);
  let title = '';
  let createFolder = options.createFolderDefault;
  let createManagement = true;

  const numberField = textField('Área', numberText, (value) => {
    numberText = value.trim();
    refresh();
  });
  const titleField = textField('Título', title, (value) => {
    title = value;
    refresh();
  });
  const { row: folderRow } = toggleField(
    'Crear también la carpeta',
    'En la raíz del sistema.',
    createFolder,
    (v) => (createFolder = v)
  );
  const { row: managementRow } = toggleField(
    'Crear la categoría de gestión (A0)',
    'Gestión del área.',
    createManagement,
    (v) => (createManagement = v)
  );
  const error = errorBanner();
  const submit = primaryButton('Crear', () => void trySubmit());

  el.append(numberField.row, titleField.row, folderRow, managementRow, error, submit);
  focusFirst(el);
  submitOnEnter(
    el,
    () => !submit.disabled,
    () => void trySubmit()
  );

  function parsedArea(): number | null {
    const areaMatch = /^(\d)0-\1?9$/.exec(numberText.trim());
    if (areaMatch) return Number(areaMatch[1]) * 10;
    if (/^\d0$/.test(numberText.trim())) return Number(numberText.trim());
    return null;
  }

  function currentError(): string | null {
    const area = parsedArea();
    if (area === null) return 'Escribe un área como 20-29.';
    if (area === 0) return '00-09 es el área del sistema.';
    if (options.index.areas.some((a) => a.number === area)) return `${areaCode(area)} ya existe.`;
    return requireTitle(title);
  }

  function refresh(): void {
    const err = currentError();
    error.textContent = err ?? '';
    submit.disabled = err !== null;
  }

  async function trySubmit(): Promise<void> {
    const area = parsedArea();
    if (currentError() !== null || area === null) return;
    await options.onSubmit({
      area,
      title,
      createFolder,
      createManagementCategory: createManagement
    });
  }

  refresh();
}

// ---- Crear cabecera -------------------------------------------------------------------

export interface CreateHeaderDialogOptions {
  index: JdIndex;
  categories: readonly CategoryEntry[];
  onSubmit(request: CreateHeaderRequest): Promise<void>;
}

export function mountCreateHeaderDialog(el: HTMLElement, options: CreateHeaderDialogOptions): void {
  let category = options.categories[0];
  let id = category ? (nextFreeHeader(options.index, category.number) ?? '') : '';
  let title = '';
  let emoji = '';

  const categoryField = selectField(
    'Categoría',
    options.categories.map((c) => ({ value: c.number, label: c.label })),
    category?.number ?? '',
    (value) => {
      const next = options.categories.find((c) => c.number === value);
      if (!next) return;
      category = next;
      id = nextFreeHeader(options.index, category.number) ?? '';
      idField.input.value = id;
      refresh();
    }
  );
  const idField = textField('Número', id, (value) => {
    id = value.trim();
    refresh();
  });
  const emojiField = textField('Emoji (opcional)', emoji, (value) => {
    emoji = value.trim();
  });
  const titleField = textField('Título', title, (value) => {
    title = value;
    refresh();
  });
  const error = errorBanner();
  const submit = primaryButton('Crear', () => void trySubmit());

  el.append(categoryField.row, idField.row, emojiField.row, titleField.row, error, submit);
  focusFirst(el);
  submitOnEnter(
    el,
    () => !submit.disabled,
    () => void trySubmit()
  );

  function currentError(): string | null {
    if (!category) return 'No hay ninguna categoría en el sistema.';
    const idError = validateNewHeader(options.index, category.number, id);
    if (idError) return idError;
    return requireTitle(title);
  }

  function refresh(): void {
    const err = currentError();
    error.textContent = err ?? '';
    submit.disabled = err !== null;
  }

  async function trySubmit(): Promise<void> {
    if (currentError() !== null || !category) return;
    await options.onSubmit({ category, id, title, emoji });
  }

  refresh();
}

// ---- Crear hijo (+) -------------------------------------------------------------------

export interface CreateChildDialogOptions {
  index: JdIndex;
  parent: IdEntry;
  createFolderDefault: boolean;
  onSubmit(request: CreateChildRequest): Promise<void>;
}

export function mountCreateChildDialog(el: HTMLElement, options: CreateChildDialogOptions): void {
  let title = '';
  let createFolder = options.createFolderDefault;

  const parentLabel = document.createElement('p');
  parentLabel.className = 'hebra-jdex-dialog-hint';
  parentLabel.textContent = `Hijo de ${options.parent.label} (${options.parent.id}+).`;
  const titleField = textField('Título', title, (value) => {
    title = value;
    refresh();
  });
  const { row: folderRow } = toggleField(
    'Crear también la carpeta',
    'Una carpeta «+ Título» dentro de la carpeta del padre.',
    createFolder,
    (v) => (createFolder = v)
  );
  const error = errorBanner();
  const submit = primaryButton('Crear', () => void trySubmit());

  el.append(parentLabel, titleField.row, folderRow, error, submit);
  focusFirst(el);
  submitOnEnter(
    el,
    () => !submit.disabled,
    () => void trySubmit()
  );

  function refresh(): void {
    const err = validateNewChildTitle(options.index, options.parent, title);
    error.textContent = err ?? '';
    submit.disabled = err !== null;
  }

  async function trySubmit(): Promise<void> {
    if (validateNewChildTitle(options.index, options.parent, title) !== null) return;
    await options.onSubmit({ parent: options.parent, title, createFolder });
  }

  refresh();
}
