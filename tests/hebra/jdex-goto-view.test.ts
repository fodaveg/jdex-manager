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
    onRetire: vi.fn()
  };
}

describe('mountJdexGotoView', () => {
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

  it('elegir un ID abre sus seis acciones; «Ir a este ID» llama a onGoto', () => {
    const callbacks = noop();
    const el = document.createElement('div');
    const target = entry();
    mountJdexGotoView(el, { entries: [target], hasActiveNote: true, ...callbacks });
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();

    const actionButtons = [
      ...el.querySelectorAll('.hebra-jdex-goto-action')
    ] as HTMLButtonElement[];
    expect(actionButtons).toHaveLength(6);
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
    expect(byLabel('Copiar ruta').disabled).toBe(false); // cae al notePath
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
