// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdEntry } from '../../src/hebra/engine';
import { mountJdexInboxProcessView } from '../../src/hebra/jdex-inbox-process-view';
import type { JdexNoteRef } from '../../src/hebra/library-index';

afterEach(() => {
  document.body.replaceChildren();
});

function note(id: string, folderId: string, title: string): JdexNoteRef {
  return { id, folderId, title, path: `${title}.md` };
}

function entry(overrides: Partial<IdEntry> = {}): IdEntry {
  return {
    id: '21.11',
    category: '21',
    title: 'Hebra',
    label: '21.11 Hebra',
    folderPath: '20-29 Productos/21 Productos/21.11 Hebra',
    notePath: '00.00 JDex/21.11 Hebra.md',
    ...overrides
  };
}

function noop() {
  return {
    onMove: vi.fn(async () => {}),
    onArchive: vi.fn(async () => {}),
    onOpen: vi.fn()
  };
}

describe('mountJdexInboxProcessView', () => {
  it('sin .09 muestra Archivar desactivado y no llama al escritor', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [], folderLabel: () => 'Inbox', archiveTarget: () => null, ...callbacks });
    const archive = [...el.querySelectorAll<HTMLButtonElement>('.hebra-jdex-goto-action')].find((button) => button.textContent === 'Archivar')!;
    expect(archive.disabled).toBe(true);
    expect(archive.title).toContain('.09');
    archive.click();
    expect(callbacks.onArchive).not.toHaveBeenCalled();
  });

  it('cola vacía: aviso de nada que procesar', () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, {
      queue: [],
      entries: [],
      folderLabel: () => '',
      ...noop()
    });
    expect(el.textContent).toContain('Bandeja de entrada procesada');
  });

  it('muestra la primera nota de la cola con sus cuatro acciones', () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1'), note('n2', 'f1', 'Suelta 2')],
      entries: [],
      folderLabel: () => '00.01 Bandeja de entrada',
      ...noop()
    });
    expect(el.textContent).toContain('Suelta 1');
    expect(el.textContent).toContain('00.01 Bandeja de entrada');
    expect(el.textContent).toContain('2 nota(s) por procesar.');
    const labels = [...el.querySelectorAll('.hebra-jdex-goto-action')].map((b) => b.textContent);
    expect(labels).toEqual(['Mover…', 'Archivar', 'Omitir', 'Abrir']);
  });

  it('Omitir avanza a la siguiente sin escribir nada', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1'), note('n2', 'f1', 'Suelta 2')],
      entries: [],
      folderLabel: () => '',
      ...callbacks
    });
    const skip = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Omitir'
    ) as HTMLButtonElement;
    skip.click();
    expect(el.textContent).toContain('Suelta 2');
    expect(callbacks.onMove).not.toHaveBeenCalled();
    expect(callbacks.onArchive).not.toHaveBeenCalled();
  });

  it('Abrir llama a onOpen y avanza a la siguiente', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1'), note('n2', 'f1', 'Suelta 2')],
      entries: [],
      folderLabel: () => '',
      ...callbacks
    });
    const open = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Abrir'
    ) as HTMLButtonElement;
    open.click();
    expect(callbacks.onOpen).toHaveBeenCalledWith(note('n1', 'f1', 'Suelta 1'));
    expect(el.textContent).toContain('Suelta 2');
  });

  it('Archivar llama a onArchive y avanza', async () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1')],
      entries: [],
      folderLabel: () => '',
      ...callbacks
    });
    const archive = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Archivar'
    ) as HTMLButtonElement;
    archive.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.onArchive).toHaveBeenCalledWith(note('n1', 'f1', 'Suelta 1'));
    expect(el.textContent).toContain('Bandeja de entrada procesada');
  });

  it('Mover abre el buscador de IDs, filtrado a los que tienen carpeta', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1')],
      entries: [entry(), entry({ id: '21.09', label: '21.09 Sin carpeta', folderPath: undefined })],
      folderLabel: () => '',
      ...callbacks
    });
    const move = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Mover…'
    ) as HTMLButtonElement;
    move.click();
    const options = [...el.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toBe('21.11 Hebra');
  });

  it('elegir un ID en «Mover» llama a onMove con la nota y el ID, y avanza', async () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1'), note('n2', 'f1', 'Suelta 2')],
      entries: [entry()],
      folderLabel: () => '',
      ...callbacks
    });
    (
      [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
        (b) => b.textContent === 'Mover…'
      ) as HTMLButtonElement
    ).click();
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.onMove).toHaveBeenCalledWith(note('n1', 'f1', 'Suelta 1'), entry());
    expect(el.textContent).toContain('Suelta 2');
  });

  it('un error de «Mover» se muestra y no avanza la cola', async () => {
    const el = document.createElement('div');
    const onMove = vi.fn(async () => {
      throw new Error('No se encontró la carpeta de destino.');
    });
    mountJdexInboxProcessView(el, {
      queue: [note('n1', 'f1', 'Suelta 1')],
      entries: [entry()],
      folderLabel: () => '',
      onMove,
      onArchive: vi.fn(async () => {}),
      onOpen: vi.fn()
    });
    (
      [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
        (b) => b.textContent === 'Mover…'
      ) as HTMLButtonElement
    ).click();
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(el.textContent).toContain('No se encontró la carpeta de destino.');
  });
});

describe('mountJdexInboxProcessView: preview, trash and optional folder creation', () => {
  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);

  it('shows a preview of the note, cut at 600 characters', async () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [], folderLabel: () => 'Inbox', ...noop(), readPreview: async () => 'x'.repeat(700) });
    expect(el.querySelector('.hebra-jdex-inbox-preview')?.textContent).toBe('Cargando…');
    await vi.waitFor(() => expect(el.querySelector('.hebra-jdex-inbox-preview')?.textContent).toBe(`${'x'.repeat(600)}…`));
  });

  it('a protected note says so instead of showing a preview', async () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [], folderLabel: () => 'Inbox', ...noop(), readPreview: async () => null });
    await vi.waitFor(() => expect(el.querySelector('.hebra-jdex-inbox-preview')?.textContent).toContain('No se puede mostrar'));
  });

  it('trash needs a confirmation: the first click writes nothing, Cancel returns', async () => {
    const el = document.createElement('div');
    const onTrash = vi.fn(async () => {});
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta'), note('n2', 'f1', 'Otra')], entries: [], folderLabel: () => 'Inbox', ...noop(), onTrash });
    button(el, 'Papelera…')!.click();
    expect(onTrash).not.toHaveBeenCalled();
    expect(el.textContent).toContain('irá a la papelera');
    button(el, 'Cancelar')!.click();
    expect(onTrash).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Suelta');
    button(el, 'Papelera…')!.click();
    button(el, 'Mandar a la papelera')!.click();
    await vi.waitFor(() => expect(el.textContent).toContain('Otra'));
    expect(onTrash).toHaveBeenCalledTimes(1);
  });

  it('without onTrash there is no trash button', () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [], folderLabel: () => 'Inbox', ...noop() });
    expect(button(el, 'Papelera…')).toBeUndefined();
  });

  it('IDs without a folder are offered only when asked, and the folder is created only after confirming', async () => {
    const el = document.createElement('div');
    const onMoveCreatingFolder = vi.fn(async () => {});
    const noFolder = entry({ id: '21.12', title: 'Sin carpeta', label: '21.12 Sin carpeta', folderPath: undefined });
    const callbacks = noop();
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [noFolder], folderLabel: () => 'Inbox', ...callbacks, onMoveCreatingFolder });
    button(el, 'Mover…')!.click();
    expect(el.querySelector('[role="option"]')).toBeNull();
    const toggle = el.querySelector<HTMLInputElement>('.hebra-jdex-inbox-optional input')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    expect(el.textContent).toContain('no tiene carpeta. ¿Crearla y mover');
    expect(onMoveCreatingFolder).not.toHaveBeenCalled();
    expect(callbacks.onMove).not.toHaveBeenCalled();
    button(el, 'Crear carpeta y mover')!.click();
    await vi.waitFor(() => expect(onMoveCreatingFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), noFolder));
    expect(callbacks.onMove).not.toHaveBeenCalled();
  });

  it('without onMoveCreatingFolder the move panel has no toggle', () => {
    const el = document.createElement('div');
    mountJdexInboxProcessView(el, { queue: [note('n1', 'f1', 'Suelta')], entries: [], folderLabel: () => 'Inbox', ...noop() });
    button(el, 'Mover…')!.click();
    expect(el.querySelector('.hebra-jdex-inbox-optional')).toBeNull();
  });
});
