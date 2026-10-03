import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { jdexFrontmatterString, readJdexFrontmatter } from '../../src/hebra/frontmatter';

// `frontmatterRange` del host falso del paquete: el de Hebra (`findFrontmatterAtStart`) lo
// cubre su propio test de contrato; aquí se prueba el parseo YAML sobre el rango que da.
const markdown = createFakePluginApi().api.markdown;

describe('readJdexFrontmatter', () => {
  it('parsea el YAML de verdad: «jd: 21.20» sin comillas es el número 21.2', () => {
    const source = ['---', 'jd: 21.20', 'tipo: id', '---', '', 'Cuerpo.'].join('\n');
    const frontmatter = readJdexFrontmatter(source, markdown);
    expect(frontmatter?.jd).toBe(21.2);
    expect(typeof frontmatter?.jd).toBe('number');
  });

  it('sin frontmatter, null', () => {
    expect(readJdexFrontmatter('# Solo un título\n\nCuerpo.', markdown)).toBeNull();
  });

  it('con frontmatter que no es un objeto (una lista), null', () => {
    const source = ['---', '- uno', '- dos', '---', ''].join('\n');
    expect(readJdexFrontmatter(source, markdown)).toBeNull();
  });

  it('con YAML roto, null (nunca lanza)', () => {
    const source = ['---', 'jd: [sin cerrar', '---', ''].join('\n');
    expect(readJdexFrontmatter(source, markdown)).toBeNull();
  });

  it('un texto entre comillas se queda en texto: «jd: "21.20"» es la cadena', () => {
    const source = ['---', 'jd: "21.20"', '---', ''].join('\n');
    expect(readJdexFrontmatter(source, markdown)?.jd).toBe('21.20');
  });
});

describe('jdexFrontmatterString', () => {
  it('recorta un texto y convierte número/booleano a texto', () => {
    expect(jdexFrontmatterString({ a: '  hola  ' }, 'a')).toBe('hola');
    expect(jdexFrontmatterString({ a: 21.2 }, 'a')).toBe('21.2');
    expect(jdexFrontmatterString({ a: true }, 'a')).toBe('true');
  });

  it('sin frontmatter, sin la clave, o null: cadena vacía', () => {
    expect(jdexFrontmatterString(null, 'a')).toBe('');
    expect(jdexFrontmatterString({}, 'a')).toBe('');
    expect(jdexFrontmatterString({ a: null }, 'a')).toBe('');
  });

  it('una lista o un objeto anidado no se convierte a texto', () => {
    expect(jdexFrontmatterString({ a: [1, 2] }, 'a')).toBe('');
    expect(jdexFrontmatterString({ a: { b: 1 } }, 'a')).toBe('');
  });
});
