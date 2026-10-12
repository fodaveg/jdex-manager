// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountJdexRenameWarningView } from '../../src/hebra/jdex-rename-warning-view';

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountJdexRenameWarningView', () => {
  it('pinta el mensaje y los dos botones, con el foco en «Cancelar»', () => {
    const el = document.createElement('div');
    document.body.append(el);
    mountJdexRenameWarningView(el, {
      message: 'Aviso de prueba.',
      onContinue: vi.fn(),
      onCancel: vi.fn()
    });
    expect(el.querySelector('.hebra-jdex-warning-message')?.textContent).toBe('Aviso de prueba.');
    const cancel = el.querySelector('.hebra-jdex-dialog-secondary') as HTMLButtonElement;
    expect(cancel.textContent).toBe('Cancelar');
    expect(document.activeElement).toBe(cancel);
  });

  it('«Continuar» llama a onContinue; «Cancelar» llama a onCancel', () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    const el = document.createElement('div');
    mountJdexRenameWarningView(el, { message: 'x', onContinue, onCancel });
    (el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    const el2 = document.createElement('div');
    mountJdexRenameWarningView(el2, { message: 'x', onContinue, onCancel });
    (el2.querySelector('.hebra-jdex-dialog-secondary') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('el botón que confirma lleva su propio verbo («Retirar») y sigue sin foco inicial (a03f9648)', () => {
    const onContinue = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    mountJdexRenameWarningView(el, { message: 'x', confirmLabel: 'Retirar', onContinue, onCancel: vi.fn() });
    const confirm = el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    expect(confirm.textContent).toBe('Retirar');
    expect(document.activeElement).not.toBe(confirm);
    confirm.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
