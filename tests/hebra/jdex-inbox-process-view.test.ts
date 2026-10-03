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
