// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/hebra/engine';
import { mountJdexAuditView } from '../../src/hebra/jdex-audit-view';

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountJdexAuditView', () => {
  it('requires an explicit selection for repairs in closed informative warnings', () => {
    const finding: Finding = { kind: 'note-without-folder', informative: true, paths: ['a.md'], message: 'A sin carpeta.',
      fix: { type: 'create-folder', path: 'A', paths: ['A'] } };
    const repair = vi.fn();
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => [finding], openPath: vi.fn(), repair });
    const button = el.querySelector('.hebra-jdex-repair-apply') as HTMLButtonElement;
    const checkbox = el.querySelector('.hebra-jdex-repair-select') as HTMLInputElement;
    expect(el.querySelector('details')?.open).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Reparar (0)');
    expect(el.textContent).toContain('Selecciona');
    button.dispatchEvent(new Event('click'));
    expect(repair).not.toHaveBeenCalled();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Reparar (1)');
    button.click();
    expect(repair).toHaveBeenCalledWith([finding]);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new Event('click'));
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('counts only mechanical frontmatter as initially selected and never selects a manual move', () => {
    const mechanical: Finding = { kind: 'frontmatter-mismatch', paths: ['a.md'], message: 'Metadatos.',
      fix: { type: 'frontmatter', path: 'a.md', set: { jd: '21.13' } } };
    const manual: Finding = { kind: 'out-of-parent', paths: ['B'], message: 'Mover.',
      fix: { type: 'move', items: [{ from: 'B', to: 'C' }] } };
    const repair = vi.fn();
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => [mechanical, manual], openPath: vi.fn(), repair });
    const button = el.querySelector('.hebra-jdex-repair-apply') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Reparar (1)');
    button.click();
    expect(repair).toHaveBeenCalledWith([mechanical]);
  });

  it('sin hallazgos, el mensaje de «sin problemas» y ninguna sección', () => {
    const el = document.createElement('div');
    mountJdexAuditView(el, { findings: () => [], openPath: vi.fn() });
    expect(el.textContent).toContain('Sin problemas');
    expect(el.querySelectorAll('section')).toHaveLength(0);
    expect(el.classList.contains('hebra-jdex-audit')).toBe(true);
    expect(el.querySelector('details')).toBeNull();
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
    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Avisos (1)');
  });

  it('separa los avisos al final, incluso cuando comparten tipo con un problema', () => {
    const findings: Finding[] = [
      { kind: 'folder-without-note', paths: ['aviso.md'], message: 'Aviso.', informative: true },
      { kind: 'folder-without-note', paths: ['problema'], message: 'Problema.' },
      { kind: 'duplicate-id', paths: [], message: 'Otro aviso.', informative: true }
    ];
    const el = document.createElement('div');
    const openPath = vi.fn();
    const unmount = mountJdexAuditView(el, { findings: () => findings, openPath });
    const problemSection = el.querySelector(':scope > section')!;
    expect(problemSection.textContent).toContain('Problema.');
    expect(problemSection.textContent).not.toContain('Aviso.');
    const details = el.querySelector('details')!;
    expect(el.lastElementChild).toBe(details);
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Avisos (2)');
    expect(details.querySelectorAll('section')).toHaveLength(2);
    details.open = true;
    (details.querySelector('button') as HTMLButtonElement).click();
    expect(openPath).toHaveBeenCalledWith('aviso.md');
    unmount();
    expect(el.children).toHaveLength(0);
    expect(el.classList.contains('hebra-jdex-audit')).toBe(false);
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
