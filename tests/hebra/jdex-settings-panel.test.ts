// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { mountJdexSettingsPanel } from '../../src/hebra/jdex-settings-panel';

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountJdexSettingsPanel', () => {
  it('pinta un campo de texto por carpeta con su valor actual', () => {
    const el = document.createElement('div');
    const settings = { ...DEFAULT_SETTINGS, jdexFolder: 'Sistema/00.00 JDex' };
    mountJdexSettingsPanel(el, {
      get: () => settings,
      save: vi.fn(),
      pickFolder: vi.fn(async () => '')
    });
    const inputs = [...el.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
    // 4 carpetas + id de sistema = 5 campos.
    expect(inputs).toHaveLength(5);
    expect(inputs.find((i) => i.value === 'Sistema/00.00 JDex')).toBeTruthy();
  });

  it('cambiar un campo y perder el foco (`change`) guarda el valor nuevo', () => {
    const el = document.createElement('div');
    let settings = { ...DEFAULT_SETTINGS };
    const save = vi.fn((next: typeof settings) => {
      settings = next;
    });
    mountJdexSettingsPanel(el, { get: () => settings, save, pickFolder: vi.fn(async () => '') });
    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'Área/Categoría';
    input.dispatchEvent(new Event('change'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ systemRoot: 'Área/Categoría' }));
  });

  it('«Elegir carpeta…» escribe la ruta que resuelve pickFolder y guarda', async () => {
    const el = document.createElement('div');
    let settings = { ...DEFAULT_SETTINGS };
    const save = vi.fn((next: typeof settings) => {
      settings = next;
    });
    const pickFolder = vi.fn(async () => 'Sistema/00.00 JDex');
    mountJdexSettingsPanel(el, { get: () => settings, save, pickFolder });
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Elegir carpeta')
    ) as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ systemRoot: 'Sistema/00.00 JDex' })
    );
  });

  it('cancelar «Elegir carpeta…» (null) conserva el valor previo y no guarda', async () => {
    const el = document.createElement('div');
    const settings = { ...DEFAULT_SETTINGS, systemRoot: 'Sistema/Previo' };
    const save = vi.fn();
    mountJdexSettingsPanel(el, { get: () => settings, save, pickFolder: vi.fn(async () => null) });
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Elegir carpeta')
    ) as HTMLButtonElement;
    button.click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect((el.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('Sistema/Previo');
    expect(save).not.toHaveBeenCalled();
  });

  it('no guarda si el valor no cambió', () => {
    const el = document.createElement('div');
    const settings = { ...DEFAULT_SETTINGS, systemRoot: 'Ya configurado' };
    const save = vi.fn();
    mountJdexSettingsPanel(el, { get: () => settings, save, pickFolder: vi.fn(async () => '') });
    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    input.dispatchEvent(new Event('change'));
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps structure findings off by default and lets the user explicitly enable them', () => {
    const el = document.createElement('div');
    const save = vi.fn();
    mountJdexSettingsPanel(el, { get: () => DEFAULT_SETTINGS, save, pickFolder: vi.fn(async () => '') });
    const row = [...el.querySelectorAll('label')].find((label) => label.textContent?.includes('Avisar de áreas y categorías sin nota'))!;
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ structureNotesAreFindings: true }));
  });

  it('lets the archive date use the monthly format from settings', () => {
    const el = document.createElement('div');
    const save = vi.fn();
    mountJdexSettingsPanel(el, { get: () => DEFAULT_SETTINGS, save, pickFolder: vi.fn(async () => '') });
    const date = el.querySelector<HTMLSelectElement>('select')!;
    expect(date.value).toBe('YYYY-MM-DD');
    date.value = 'YYYY-MM';
    date.dispatchEvent(new Event('change'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ dateFormat: 'YYYY-MM' }));
  });

});
