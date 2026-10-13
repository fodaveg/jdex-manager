// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdEntry } from '../../src/hebra/engine';
import { mountJdexGotoView } from '../../src/hebra/jdex-goto-view';

afterEach(() => {
  document.body.replaceChildren();
});

function entry(overrides: Partial<IdEntry> = {}): IdEntry {
  return {
    id: '21.11',
    category: '21',
    title: 'Hebra',
    label: '21.11 Hebra',
    folderPath: '20-29 Productos/21 Productos de software/21.11 Hebra',
    notePath: '00.00 JDex/21.11 Hebra.md',
    ...overrides
  };
}

function noop() {
  return {
    onGoto: vi.fn(),
    onMoveNoteHere: vi.fn(),
    onSearchWithin: vi.fn(),
    onCopyId: vi.fn(),
    onCopyPath: vi.fn(),
    onCopyJdPath: vi.fn(),
    onRetire: vi.fn()
  };
}

describe('mountJdexGotoView', () => {
  it('monta controles y recibe clics en el documento de una superficie', () => {
    const surface = document.implementation.createHTMLDocument('JDex');
    const el = surface.createElement('div');
    surface.body.append(el);
    const actions = noop();
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: true, ...actions });
    expect([...el.querySelectorAll('*')].every((node) => node.ownerDocument === surface)).toBe(true);
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    (el.querySelector('.hebra-jdex-goto-action') as HTMLButtonElement).click();
    expect(actions.onGoto).toHaveBeenCalledWith(entry());
  });

  it('lista todos los IDs y filtra al buscar', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, {
      entries: [entry(), entry({ id: '21.12', label: '21.12 Otro' })],
      hasActiveNote: true,
      ...noop()
    });
    expect(el.querySelectorAll('[role="option"]')).toHaveLength(2);

    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = '21.12';
    search.dispatchEvent(new Event('input'));
    const options = [...el.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toBe('21.12 Otro');
  });

  it('sin coincidencias, un aviso', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: true, ...noop() });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'no existe ningún id así';
    search.dispatchEvent(new Event('input'));
    expect(el.textContent).toContain('Ningún ID coincide');
  });

  it('elegir un ID abre sus siete acciones; «Ir a este ID» llama a onGoto', () => {
    const callbacks = noop();
    const el = document.createElement('div');
    const target = entry();
    mountJdexGotoView(el, { entries: [target], hasActiveNote: true, ...callbacks });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();

    const actionButtons = [
      ...el.querySelectorAll('.hebra-jdex-goto-action')
    ] as HTMLButtonElement[];
    expect(actionButtons).toHaveLength(7);
    const goto = actionButtons.find((b) => b.textContent === 'Ir a este ID')!;
    goto.click();
    expect(callbacks.onGoto).toHaveBeenCalledWith(target);
  });

  it('sin nota abierta, «Mover la nota abierta aquí» sale deshabilitada con su motivo', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: false, ...noop() });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    const moveHere = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Mover la nota abierta aquí'
    ) as HTMLButtonElement;
    expect(moveHere.disabled).toBe(true);
    expect(moveHere.title).toBe('Abre una nota para moverla aquí.');
  });

  it('un ID sin carpeta deshabilita ir/mover/buscar/copiar ruta, pero deja copiar ID', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, {
      entries: [entry({ folderPath: undefined })],
      hasActiveNote: true,
      ...noop()
    });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    const byLabel = (label: string) =>
      [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
        (b) => b.textContent === label
      ) as HTMLButtonElement;
    expect(byLabel('Ir a este ID').disabled).toBe(false); // tiene notePath
    expect(byLabel('Mover la nota abierta aquí').disabled).toBe(true);
    expect(byLabel('Buscar dentro de este ID').disabled).toBe(true);
    expect(byLabel('Copiar ID').disabled).toBe(false);
    expect(byLabel('Copiar ruta de la nota').disabled).toBe(false); // cae al notePath, y lo dice
    expect(byLabel('Copiar ruta de carpeta')).toBeUndefined();
  });

  it('«Copiar ruta JD» (texto) es distinta de «Copiar ruta de carpeta» (a03f9648)', () => {
    const el = document.createElement('div');
    const handlers = noop();
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: true, ...handlers });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    const byLabel = (label: string) =>
      [...el.querySelectorAll('.hebra-jdex-goto-action')].find((b) => b.textContent === label) as HTMLButtonElement;
    byLabel('Copiar ruta JD').click();
    expect(handlers.onCopyJdPath).toHaveBeenCalledWith(expect.objectContaining({ id: '21.11' }));
    expect(handlers.onCopyPath).not.toHaveBeenCalled();
    byLabel('Copiar ruta de carpeta').click();
    expect(handlers.onCopyPath).toHaveBeenCalledTimes(1);
  });

  it('un ID sin nota JDex deshabilita «Retirar este ID» con su motivo', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, {
      entries: [entry({ notePath: undefined })],
      hasActiveNote: true,
      ...noop()
    });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    const retire = [...el.querySelectorAll('.hebra-jdex-goto-action')].find(
      (b) => b.textContent === 'Retirar este ID'
    ) as HTMLButtonElement;
    expect(retire.disabled).toBe(true);
    expect(retire.title).toContain('no tiene nota JDex');
  });

  it('Escape en el panel de acciones vuelve a la búsqueda', () => {
    const el = document.createElement('div');
    document.body.append(el);
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: true, ...noop() });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    expect((el.querySelector('.hebra-jdex-goto-actions') as HTMLElement).hidden).toBe(false);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((el.querySelector('.hebra-jdex-goto-actions') as HTMLElement).hidden).toBe(true);
    expect((el.querySelector('input[type="search"]') as HTMLInputElement).hidden).toBe(false);
  });
  it('disables retiring again and shows the original retirement date', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, { entries: [entry()], hasActiveNote: true, retiredAt: () => '2026-09-21', ...callbacks });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    const button = [...el.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Ya retirado el 2026-09-21')!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(callbacks.onRetire).not.toHaveBeenCalled();
  });

});

describe('mountJdexGotoView — teclado y ARIA', () => {
  const key = (el: Element, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
  };
  const three = [
    entry({ id: '21.11', label: '21.11 Uno' }),
    entry({ id: '21.12', label: '21.12 Dos' }),
    entry({ id: '21.13', label: '21.13 Tres' })
  ];

  it('Enter en el buscador abre (va a) el resultado resaltado, el primero por defecto', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...callbacks });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    key(search, 'Enter');
    expect(callbacks.onGoto).toHaveBeenCalledWith(three[0]);
  });

  it('las flechas mueven el resaltado y Enter va al nuevo; no se pasa de los extremos', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...callbacks });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    key(search, 'ArrowDown');
    key(search, 'ArrowDown');
    key(search, 'ArrowDown');
    key(search, 'Enter');
    expect(callbacks.onGoto).toHaveBeenCalledWith(three[2]);
    key(search, 'ArrowUp');
    key(search, 'ArrowUp');
    key(search, 'ArrowUp');
    key(search, 'Enter');
    expect(callbacks.onGoto).toHaveBeenLastCalledWith(three[0]);
  });

  it('el resaltado se anuncia: aria-activedescendant apunta a la opción con aria-selected', () => {
    const el = document.createElement('div');
    document.body.append(el);
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...noop() });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    key(search, 'ArrowDown');
    const options = [...el.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(options[1].id).not.toBe('');
  });

  it('buscar recoloca el resaltado en el primer resultado', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...callbacks });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    key(search, 'ArrowDown');
    search.value = 'tres';
    search.dispatchEvent(new Event('input'));
    key(search, 'Enter');
    expect(callbacks.onGoto).toHaveBeenCalledWith(three[2]);
  });

  it('el buscador es un combobox que controla la lista; la lista es un listbox de opciones', () => {
    const el = document.createElement('div');
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...noop() });
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    const list = el.querySelector('[role="listbox"]') as HTMLElement;
    expect(search.getAttribute('role')).toBe('combobox');
    expect(search.getAttribute('aria-controls')).toBe(list.id);
    // Los <li> no son roles de lista dentro de un listbox: las opciones son sus descendientes.
    expect([...list.children].every((li) => li.getAttribute('role') === 'none')).toBe(true);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it('avisa del recorte cuando hay más de 200 resultados', () => {
    const el = document.createElement('div');
    const many = Array.from({ length: 250 }, (_, i) => entry({ id: `21.${i}`, label: `21.${i} ID ${i}` }));
    mountJdexGotoView(el, { entries: many, hasActiveNote: true, ...noop() });
    expect(el.querySelectorAll('[role="option"]')).toHaveLength(200);
    const status = el.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain('Se muestran 200 de 250');
  });

  it('un ID sin carpeta ni nota no tiene a dónde ir: Enter abre el panel de acciones con el motivo', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, {
      entries: [entry({ folderPath: undefined, notePath: undefined })],
      hasActiveNote: true,
      ...callbacks
    });
    key(el.querySelector('input[type="search"]') as HTMLInputElement, 'Enter');
    expect(callbacks.onGoto).not.toHaveBeenCalled();
    expect((el.querySelector('.hebra-jdex-goto-actions') as HTMLElement).hidden).toBe(false);
  });

  it('el clic en una fila sigue abriendo las acciones (el resto, tras Tab)', () => {
    const el = document.createElement('div');
    const callbacks = noop();
    mountJdexGotoView(el, { entries: three, hasActiveNote: true, ...callbacks });
    (el.querySelectorAll('[role="option"]')[1] as HTMLButtonElement).click();
    expect(callbacks.onGoto).not.toHaveBeenCalled();
    expect((el.querySelector('.hebra-jdex-goto-actions') as HTMLElement).hidden).toBe(false);
  });
});
