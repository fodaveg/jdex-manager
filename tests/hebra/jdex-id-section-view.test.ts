// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JdexIdSectionData } from '../../src/hebra/jdex-id-section';
import { mountJdexIdSectionView } from '../../src/hebra/jdex-id-section-view';

afterEach(() => {
  document.body.replaceChildren();
});

const EMPTY: JdexIdSectionData = {
  located: null,
  entry: null,
  categoryLabel: '',
  description: '',
  files: [],
  children: [],
  siblings: []
};

describe('mountJdexIdSectionView', () => {
  it('nota fuera del sistema JDex: aviso', () => {
    const el = document.createElement('div');
    mountJdexIdSectionView(el, {
      data: EMPTY,
      onGoto: vi.fn(),
      onOpenNote: vi.fn(),
      onCreateChild: vi.fn(),
      isoDates: () => false
    });
    expect(el.textContent).toContain('no vive en ningún ID');
  });

  it('ruta, descripción, ficheros, hijos y hermanos', () => {
    const data: JdexIdSectionData = {
      located: null,
      entry: {
        id: '21.11',
        category: '21',
        title: 'Hebra',
        label: '21.11 Hebra',
        folderPath: '20-29/21/21.11 Hebra',
        notePath: '00.00 JDex/21.11 Hebra.md'
      },
      categoryLabel: '21 Productos de software',
      description: 'Notas locales.',
      files: [
        { name: 'Notas de Hebra', date: 100, kind: 'note', id: 'n-content' },
        { name: 'captura.png', date: 200, kind: 'file' }
      ],
      children: [
        {
          id: '21.11+',
          category: '21',
          title: 'Hebra',
          label: '21.11+ Hebra (extensión)',
          folderPath: undefined,
          notePath: undefined
        }
      ],
      siblings: [{ id: '21.12', category: '21', title: 'Otro', label: '21.12 Otro' }]
    };
    const el = document.createElement('div');
    const onGoto = vi.fn();
    const onOpenNote = vi.fn();
    const onCreateChild = vi.fn();
    mountJdexIdSectionView(el, { data, onGoto, onOpenNote, onCreateChild, isoDates: () => false });

    expect(el.textContent).toContain('21 Productos de software › 21.11 Hebra');
    expect(el.textContent).toContain('Notas locales.');
    expect(el.textContent).toContain('Ficheros de la carpeta (2)');

    const noteLink = [...el.querySelectorAll('.hebra-jdex-section-link')].find(
      (b) => b.textContent === 'Notas de Hebra'
    ) as HTMLButtonElement;
    noteLink.click();
    expect(onOpenNote).toHaveBeenCalledWith('n-content');

    const siblingLink = [...el.querySelectorAll('.hebra-jdex-section-link')].find(
      (b) => b.textContent === '21.12 Otro'
    ) as HTMLButtonElement;
    siblingLink.click();
    expect(onGoto).toHaveBeenCalledWith(data.siblings[0]);

    (el.querySelector('.hebra-jdex-section-add') as HTMLButtonElement).click();
    expect(onCreateChild).toHaveBeenCalled();
  });
});

describe('fechas de los ficheros (api.env.isoDates)', () => {
  const noon = new Date(2026, 9, 3, 12, 0).getTime();
  const data: JdexIdSectionData = {
    located: null,
    entry: {
      id: '21.11',
      category: '21',
      title: 'Hebra',
      label: '21.11 Hebra',
      folderPath: '20-29/21/21.11 Hebra',
      notePath: undefined
    },
    categoryLabel: '21 Productos',
    description: '',
    files: [{ name: 'captura.png', date: noon, kind: 'file' }],
    children: [],
    siblings: []
  };
  const options = { data, onGoto: vi.fn(), onOpenNote: vi.fn(), onCreateChild: vi.fn() };

  it('con el ajuste ISO encendido, 2026-10-03', () => {
    const el = document.createElement('div');
    mountJdexIdSectionView(el, { ...options, isoDates: () => true });
    expect(el.querySelector('.hebra-jdex-section-row small')?.textContent).toBe('2026-10-03');
  });

  it('con el ajuste apagado, el formato español día/mes/año', () => {
    const el = document.createElement('div');
    mountJdexIdSectionView(el, { ...options, isoDates: () => false });
    expect(el.querySelector('.hebra-jdex-section-row small')?.textContent).toBe('03/10/2026');
  });
});
