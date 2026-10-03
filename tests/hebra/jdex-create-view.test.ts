// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import {
  mountCreateAreaDialog,
  mountCreateCategoryDialog,
  mountCreateChildDialog,
  mountCreateHeaderDialog,
  mountCreateIdDialog
} from '../../src/hebra/jdex-create-view';

afterEach(() => {
  document.body.replaceChildren();
});

/** Categoría `21` con `.11` usada y `.20` (cabecera) usada: el siguiente ID libre toma
 *  el MÁXIMO en uso + 1 (`nextFreeId`), así que salta de `.20` a `.21`, no a `.12`. */
function fixtureIndex() {
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: '00.00 JDex',
    folderPaths: [
      '20-29 Productos',
      '20-29 Productos/21 Productos de software',
      '20-29 Productos/21 Productos de software/21.11 Hebra',
      '20-29 Productos/21 Productos de software/21.20 ■ Cabecera'
    ],
    notePaths: [
      '00.00 JDex/20-29 Productos.md',
      '00.00 JDex/21 Productos de software.md',
      '00.00 JDex/21.11 Hebra.md',
      '00.00 JDex/21.20 ■ Cabecera.md'
    ]
  };
  return buildIndex(input);
}

/** Solo los `<input type="text">` del diálogo (la categoría/área es un `<select>`, la
 *  casilla es `<input type="checkbox">`). */
function textInputs(el: HTMLElement): HTMLInputElement[] {
  return [...el.querySelectorAll('input[type="text"]')] as HTMLInputElement[];
}

describe('mountCreateIdDialog', () => {
  it('propone el siguiente libre saltando ceros y cabeceras (.21, no .12)', () => {
    const index = fixtureIndex();
    const el = document.createElement('div');
    mountCreateIdDialog(el, {
      index,
      categories: index.categories,
      createFolderDefault: false,
      onSubmit: vi.fn()
    });
    const [numberInput] = textInputs(el);
    expect(numberInput.value).toBe('21.21');
  });

  it('con el número de una carpeta ya ocupada, el botón queda deshabilitado', () => {
    const index = fixtureIndex();
    const el = document.createElement('div');
    mountCreateIdDialog(el, {
      index,
      categories: index.categories,
      createFolderDefault: false,
      onSubmit: vi.fn()
    });
    const [numberInput, titleInput] = textInputs(el);
    numberInput.value = '21.11';
    numberInput.dispatchEvent(new Event('input'));
    titleInput.value = 'Choca con Hebra';
    titleInput.dispatchEvent(new Event('input'));
    const submit = el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(el.querySelector('.hebra-jdex-dialog-error')?.textContent).toMatch(/Ya lo usa/);
  });

  it('válido, «Crear» llama a onSubmit con el número, el título y la carpeta', async () => {
    const index = fixtureIndex();
    const onSubmit = vi.fn(async () => {});
    const el = document.createElement('div');
    mountCreateIdDialog(el, {
      index,
      categories: index.categories,
      createFolderDefault: true,
      onSubmit
    });
    const [numberInput, titleInput] = textInputs(el);
    numberInput.value = '21.31';
    numberInput.dispatchEvent(new Event('input'));
    titleInput.value = 'Módulo nuevo';
    titleInput.dispatchEvent(new Event('input'));
    const submit = el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: '21.31', title: 'Módulo nuevo', createFolder: true })
    );
  });
});

describe('mountCreateCategoryDialog', () => {
  it('rechaza el número de gestión del área (igual al área)', () => {
    const index = fixtureIndex();
    const el = document.createElement('div');
    mountCreateCategoryDialog(el, {
      index,
      areas: index.areas,
      createFolderDefault: false,
      onSubmit: vi.fn()
    });
    const [numberInput] = textInputs(el);
    numberInput.value = '20';
    numberInput.dispatchEvent(new Event('input'));
    expect(el.querySelector('.hebra-jdex-dialog-error')?.textContent).toMatch(/gestión/);
  });

  it('válida, onSubmit lleva las casillas de inbox y archivo', async () => {
    const index = fixtureIndex();
    const onSubmit = vi.fn(async () => {});
    const el = document.createElement('div');
    mountCreateCategoryDialog(el, {
      index,
      areas: index.areas,
      createFolderDefault: false,
      onSubmit
    });
    const [, titleInput] = textInputs(el);
    titleInput.value = 'Otra categoría';
    titleInput.dispatchEvent(new Event('input'));
    const submit = el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    submit.click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ category: '22', createInbox: true, createArchive: true })
    );
  });
});

describe('mountCreateAreaDialog', () => {
  it('el área libre siguiente ya viene sugerida (10-19, la única en uso es 20-29); una ya existente da error', () => {
    const index = fixtureIndex();
    const el = document.createElement('div');
    mountCreateAreaDialog(el, { index, createFolderDefault: false, onSubmit: vi.fn() });
    const [numberInput, titleInput] = textInputs(el);
    expect(numberInput.value).toBe('10-19');
    titleInput.value = 'Área nueva';
    titleInput.dispatchEvent(new Event('input'));
    expect(el.querySelector('.hebra-jdex-dialog-error')?.textContent).toBe('');
    numberInput.value = '20-29';
    numberInput.dispatchEvent(new Event('input'));
    expect(el.querySelector('.hebra-jdex-dialog-error')?.textContent).toMatch(/ya existe/);
  });
});

describe('mountCreateHeaderDialog', () => {
  it('propone la primera cabecera libre por orden (.10, aunque .11 y .20 ya estén usadas)', () => {
    const index = fixtureIndex();
    const el = document.createElement('div');
    mountCreateHeaderDialog(el, { index, categories: index.categories, onSubmit: vi.fn() });
    const [numberInput] = textInputs(el);
    expect(numberInput.value).toBe('21.10');
  });
});

describe('mountCreateChildDialog', () => {
  it('el número es fijo (padre.id+) y solo el título se valida', async () => {
    const index = fixtureIndex();
    const parent = index.ids.find((e) => e.id === '21.11')!;
    const onSubmit = vi.fn(async () => {});
    const el = document.createElement('div');
    mountCreateChildDialog(el, { index, parent, createFolderDefault: false, onSubmit });
    expect(el.textContent).toContain('21.11+');
    const submit = el.querySelector('.hebra-jdex-dialog-primary') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const [titleInput] = textInputs(el);
    titleInput.value = 'Extensión';
    titleInput.dispatchEvent(new Event('input'));
    expect(submit.disabled).toBe(false);
    submit.click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ parent, title: 'Extensión' }));
  });
});
