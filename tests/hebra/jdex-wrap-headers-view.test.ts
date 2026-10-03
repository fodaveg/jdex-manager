// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JdexWrapCandidate } from '../../src/hebra/jdex-wrap-headers';
import { mountJdexWrapHeadersView } from '../../src/hebra/jdex-wrap-headers-view';

afterEach(() => {
  document.body.replaceChildren();
});

function candidate(noteId: string, label: string): JdexWrapCandidate {
  return {
    noteId,
    path: `${label}.md`,
    label,
    before: '- [[a]]',
    after: '<!-- jdex:hijos -->\n- [[a]]\n<!-- /jdex:hijos -->'
  };
}

describe('mountJdexWrapHeadersView', () => {
  it('sin candidatas, el mensaje de que ninguna necesita marcadores', () => {
    const el = document.createElement('div');
    mountJdexWrapHeadersView(el, { candidates: [], onApply: vi.fn() });
    expect(el.textContent).toContain('Ninguna cabecera');
  });

  it('una fila por candidata, marcada por defecto, con vista previa del añadido', () => {
    const el = document.createElement('div');
    mountJdexWrapHeadersView(el, {
      candidates: [candidate('n1', '21.10 ■ Cabecera')],
      onApply: vi.fn()
    });
    expect(el.textContent).toContain('21.10 ■ Cabecera');
    expect(el.querySelector('.hebra-jdex-wrap-preview')?.textContent).toContain('jdex:hijos');
    expect(el.querySelector('.hebra-jdex-dialog-primary')?.textContent).toBe('Aplicar (1)');
  });

  it('«Aplicar» llama a onApply solo con las marcadas', async () => {
    const onApply = vi.fn(async () => {});
    const el = document.createElement('div');
    mountJdexWrapHeadersView(el, {
      candidates: [candidate('n1', 'Uno'), candidate('n2', 'Dos')],
      onApply
    });
    const [first] = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    first.checked = false;
    first.dispatchEvent(new Event('change'));
    (el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onApply).toHaveBeenCalledWith(new Set(['n2']));
  });
});
