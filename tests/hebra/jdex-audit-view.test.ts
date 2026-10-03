// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/hebra/engine';
import { mountJdexAuditView } from '../../src/hebra/jdex-audit-view';

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountJdexAuditView', () => {
  it('sin hallazgos, el mensaje de «sin problemas» y ninguna sección', () => {
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => [], openPath: vi.fn() });
    expect(el.textContent).toContain('Sin problemas');
    expect(el.querySelectorAll('section')).toHaveLength(0);
  });

  it('agrupa por tipo con el título del motor y el recuento', () => {
    const findings: Finding[] = [
      { kind: 'folder-without-note', paths: ['a'], message: 'A sin nota.' },
      { kind: 'folder-without-note', paths: ['b'], message: 'B sin nota.' },
      { kind: 'duplicate-id', paths: ['c', 'd'], message: 'c y d duplicados.' }
    ];
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => findings, openPath: vi.fn() });
    const headings = [...el.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Carpetas con ID sin nota en el JDex (2)', 'IDs duplicados (1)']);
    expect(el.textContent).toContain('3 problema(s) que corregir.');
  });

  it('un hallazgo informativo cuenta en su grupo pero no en el resumen', () => {
    const findings: Finding[] = [
      { kind: 'note-without-folder', paths: ['a'], message: 'A.', informative: true }
    ];
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => findings, openPath: vi.fn() });
    expect(el.textContent).toContain('Sin problemas');
    expect(el.querySelector('h3')?.textContent).toBe('Notas sin carpeta (informativo) (1)');
  });

  it('cada ruta es un botón que llama a openPath con esa ruta', () => {
    const openPath = vi.fn();
    const findings: Finding[] = [
      { kind: 'duplicate-id', paths: ['uno.md', 'dos.md'], message: 'x' }
    ];
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => findings, openPath });
    const links = [...el.querySelectorAll('button.hebra-jdex-audit-link')];
    expect(links.map((b) => b.textContent)).toEqual(['uno.md', 'dos.md']);
    (links[1] as HTMLButtonElement).click();
    expect(openPath).toHaveBeenCalledWith('dos.md');
  });

  it('un hallazgo de frontmatter lleva «Aplicar» solo con applyFrontmatterFix', () => {
    const findings: Finding[] = [
      {
        kind: 'frontmatter-mismatch',
        paths: ['a.md'],
        message: 'jd debería ser «21.20».',
        fix: { type: 'frontmatter', path: 'a.md', set: { jd: '21.20' } }
      }
    ];
    const sinAplicar = document.createElement('div');
    mountJdexAuditView(sinAplicar, { findings: () => findings, openPath: vi.fn() });
    expect(sinAplicar.querySelector('.hebra-jdex-audit-apply')).toBeNull();

    const applyFrontmatterFix = vi.fn();
    const conAplicar = document.createElement('div');
    mountJdexAuditView(conAplicar, {
      findings: () => findings,
      openPath: vi.fn(),
      applyFrontmatterFix
    });
    const apply = conAplicar.querySelector('.hebra-jdex-audit-apply') as HTMLButtonElement;
    expect(apply).toBeTruthy();
    apply.click();
    expect(applyFrontmatterFix).toHaveBeenCalledWith(findings[0]);
  });

  it('un hallazgo sin `fix` de frontmatter (p. ej. `rename`) no lleva «Aplicar»', () => {
    const findings: Finding[] = [
      {
        kind: 'name-mismatch',
        paths: ['a.md', 'b'],
        message: 'x',
        fix: { type: 'rename', from: 'b', to: 'c' }
      }
    ];
    const el = document.createElement('div');
    mountJdexAuditView(el, {
      findings: () => findings,
      openPath: vi.fn(),
      applyFrontmatterFix: vi.fn()
    });
    expect(el.querySelector('.hebra-jdex-audit-apply')).toBeNull();
  });
});
