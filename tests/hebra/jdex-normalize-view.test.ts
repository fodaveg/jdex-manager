// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/hebra/engine';
import { mountJdexNormalizeView } from '../../src/hebra/jdex-normalize-view';

afterEach(() => {
  document.body.replaceChildren();
});

function finding(path: string, message: string): Finding {
  return {
    kind: 'frontmatter-mismatch',
    paths: [path],
    message,
    fix: { type: 'frontmatter', path, set: { jd: path } }
  };
}

describe('mountJdexNormalizeView', () => {
  it('sin hallazgos, el mensaje de que no hay nada que normalizar', () => {
    const el = document.createElement('div');
    mountJdexNormalizeView(el, { findings: [], onApply: vi.fn() });
    expect(el.textContent).toContain('nada que normalizar');
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });

  it('una fila por hallazgo, todas marcadas por defecto', () => {
    const el = document.createElement('div');
    mountJdexNormalizeView(el, {
      findings: [finding('a.md', 'A mal.'), finding('b.md', 'B mal.')],
      onApply: vi.fn()
    });
    const checkboxes = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((c) => c.checked)).toBe(true);
    expect(el.querySelector('.hebra-jdex-dialog-primary')?.textContent).toBe('Aplicar (2)');
  });

  it('desmarcar una fila la quita de lo que se aplica', async () => {
    const onApply = vi.fn(async () => {});
    const el = document.createElement('div');
    mountJdexNormalizeView(el, {
      findings: [finding('a.md', 'A mal.'), finding('b.md', 'B mal.')],
      onApply
    });
    const [first] = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    first.checked = false;
    first.dispatchEvent(new Event('change'));
    expect(el.querySelector('.hebra-jdex-dialog-primary')?.textContent).toBe('Aplicar (1)');
    (el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onApply).toHaveBeenCalledWith(new Set(['b.md']));
  });

  it('sin ninguna marcada, «Aplicar» no llama a onApply y avisa', () => {
    const onApply = vi.fn();
    const el = document.createElement('div');
    mountJdexNormalizeView(el, { findings: [finding('a.md', 'A mal.')], onApply });
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    (el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    expect(onApply).not.toHaveBeenCalled();
    expect(el.querySelector('.hebra-jdex-dialog-error')?.textContent).toMatch(/al menos una/);
  });
});
