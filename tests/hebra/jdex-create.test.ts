import { describe, expect, it } from 'vitest';
import { buildIndex, type IndexInput } from '../../src/hebra/engine';
import {
  requireTitle,
  validateNewChildTitle,
  validateNewHeader,
  validateNewId
} from '../../src/hebra/jdex-create';

/** Índice mínimo con un ID de contenido (`21.11`), una cabecera (`21.10 ■`) y una
 *  carpeta SIN nota JDex (`21.22`, ocupa el número aunque no tenga nota). */
function fixtureIndex() {
  const input: IndexInput = {
    systemRoot: '',
    jdexFolder: '00.00 JDex',
    folderPaths: [
      '20-29 Productos',
      '20-29 Productos/21 Productos de software',
      '20-29 Productos/21 Productos de software/21.10 ■ Cabecera',
      '20-29 Productos/21 Productos de software/21.11 Hebra',
      '20-29 Productos/21 Productos de software/21.22 JDex Manager',
      '00.00 JDex'
    ],
    notePaths: [
      '00.00 JDex/20-29 Productos.md',
      '00.00 JDex/21 Productos de software.md',
      '00.00 JDex/21.10 ■ Cabecera.md',
      '00.00 JDex/21.11 Hebra.md'
      // 21.22 JDex Manager: sin nota (ocupada solo por carpeta).
    ]
  };
  return buildIndex(input);
}

describe('validateNewId', () => {
  it('rechaza un ID ya ocupado por CARPETA aunque no tenga nota', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '21.22')).toMatch(/Ya lo usa/);
  });

  it('rechaza un ID ya ocupado por NOTA', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '21.11')).toMatch(/Ya lo usa/);
  });

  it('rechaza un número reservado (.00 a .09)', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '21.05')).toMatch(/números de gestión/);
  });

  it('rechaza un número que acaba en 0 (cabecera)', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '21.30')).toMatch(/cabeceras/);
  });

  it('rechaza de otra categoría', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '22.15')).toMatch(/tiene que ser de la categoría/);
  });

  it('rechaza texto sin forma de ID', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', 'no es un id')).toMatch(/Escribe un ID/);
  });

  it('acepta el siguiente libre', () => {
    const index = fixtureIndex();
    expect(validateNewId(index, '21', '21.23')).toBeNull();
  });
});

describe('validateNewHeader', () => {
  it('rechaza una cabecera ya ocupada', () => {
    const index = fixtureIndex();
    expect(validateNewHeader(index, '21', '21.10')).toMatch(/Ya lo usa/);
  });

  it('rechaza un número que no acaba en 0', () => {
    const index = fixtureIndex();
    expect(validateNewHeader(index, '21', '21.25')).toMatch(/acaba en 0/);
  });

  it('acepta la siguiente cabecera libre', () => {
    const index = fixtureIndex();
    expect(validateNewHeader(index, '21', '21.20')).toBeNull();
  });
});

describe('validateNewChildTitle', () => {
  const index = fixtureIndex();
  const parent = index.ids.find((entry) => entry.id === '21.11')!;

  it('rechaza título vacío', () => {
    expect(validateNewChildTitle(index, parent, '   ')).toMatch(/título/);
  });

  it('rechaza un hijo ya existente con el mismo título', () => {
    const withChild = buildIndex({
      systemRoot: '',
      jdexFolder: '00.00 JDex',
      folderPaths: [],
      notePaths: ['00.00 JDex/21.11+ Extensión.md', '00.00 JDex/21.11 Hebra.md']
    });
    const withChildParent = withChild.ids.find((e) => e.id === '21.11')!;
    expect(validateNewChildTitle(withChild, withChildParent, 'Extensión')).toMatch(
      /Ya hay un hijo/
    );
  });

  it('acepta un título nuevo', () => {
    expect(validateNewChildTitle(index, parent, 'Módulo nuevo')).toBeNull();
  });
});

describe('requireTitle', () => {
  it('rechaza vacío o solo espacios', () => {
    expect(requireTitle('')).toMatch(/título/);
    expect(requireTitle('   ')).toMatch(/título/);
  });

  it('acepta cualquier texto', () => {
    expect(requireTitle('Un título')).toBeNull();
  });
});
