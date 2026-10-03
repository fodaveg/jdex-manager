import { describe, expect, it } from 'vitest';
import {
  auditSystem,
  buildIndex,
  expectedFrontmatter,
  extractJdPrefix,
  type IndexInput
} from '../../src/hebra/engine';
import { applyJdexFrontmatterFixes, frontmatterFindingsFor } from '../../src/hebra/jdex-normalize';
import { FakeJdexVault, fakeNote, fakeSetProperty } from './support/fakes';

const markdown = { setProperty: fakeSetProperty };

const JDEX_FOLDER = '00.00 JDex';

/**
 * Un sistema con UNA nota JDex de `21.20` cuyo frontmatter tiene `jd: 21.20` SIN
 * comillas (YAML real: número 21.2, no texto «21.20», contrato del 28 sep 2026, punto
 * 1) y con una clave AJENA (`propia: dato personal`) que ninguna normalización debe
 * tocar. La categoría `21` existe como carpeta, así que `expectedFrontmatter` exige
 * `categoria`.
 */
function fixture() {
  const folderPaths = [
    JDEX_FOLDER,
    '20-29 Productos',
    '20-29 Productos/21 Productos de software',
    '20-29 Productos/21 Productos de software/21.20'
  ];
  const notePath = `${JDEX_FOLDER}/21.20 Cabecera.md`;
  const body = [
    '---',
    'jd: 21.20',
    'tipo: cabecera',
    'propia: dato personal',
    '---',
    '# 21.20 Cabecera',
    ''
  ].join('\n');
  const notePaths = [
    `${JDEX_FOLDER}/20-29 Productos.md`,
    `${JDEX_FOLDER}/21 Productos de software.md`,
    notePath
  ];
  const input: IndexInput = { systemRoot: '', jdexFolder: JDEX_FOLDER, folderPaths, notePaths };
  const index = buildIndex(input);
  const parsed = extractJdPrefix('21.20 Cabecera')!;
  return { index, notePath, body, parsed };
}

describe('frontmatterFindingsFor', () => {
  it('detecta que jd: 21.20 (sin comillas, número 21.2) no coincide con la expectativa', () => {
    const { index, notePath, body } = fixture();
    // `21.20` sin comillas parsea a YAML como número 21.2: se mide igual que lo haría
    // `readJdexFrontmatter` en producción (mismo parser `yaml`), sin duplicar aquí el
    // parseo.
    const frontmatter = { jd: 21.2, tipo: 'cabecera', propia: 'dato personal' };
    const findings = auditSystem({
      index,
      notes: [{ path: notePath, frontmatter, body }],
      filePaths: [notePath]
    });
    const scoped = frontmatterFindingsFor(findings, notePath);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].fix?.type).toBe('frontmatter');
    if (scoped[0].fix?.type === 'frontmatter') {
      expect(scoped[0].fix.set).toHaveProperty('jd', '21.20');
      // `propia` NUNCA aparece en el fix: el motor solo corrige jd/tipo/area/categoria.
      expect(scoped[0].fix.set).not.toHaveProperty('propia');
    }
  });

  it('sin `path`, da los hallazgos de TODA la JDex', () => {
    const { index, notePath, body } = fixture();
    const frontmatter = { jd: 21.2, tipo: 'cabecera' };
    const findings = auditSystem({
      index,
      notes: [{ path: notePath, frontmatter, body }],
      filePaths: [notePath]
    });
    expect(frontmatterFindingsFor(findings)).toHaveLength(1);
  });
});

describe('applyJdexFrontmatterFixes', () => {
  it('fusiona SOLO jd/tipo/area/categoria y conserva `propia` byte a byte', async () => {
    const { index, notePath, body } = fixture();
    const frontmatter = { jd: 21.2, tipo: 'cabecera', propia: 'dato personal' };
    const findings = auditSystem({
      index,
      notes: [{ path: notePath, frontmatter, body }],
      filePaths: [notePath]
    });
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('note-1', 'f-jdex', body));
    const result = await applyJdexFrontmatterFixes(library, markdown, findings, () => 'note-1');
    expect(result.written).toEqual(['note-1']);
    const after = await library.noteRead('note-1');
    // `jd` ahora entre comillas: sin ambigüedad de tipo YAML la próxima vez que se lea.
    expect(after?.body).toContain('jd: "21.20"');
    // `categoria` y `area` fusionadas (faltaban): la categoría y el área existen en el
    // índice.
    expect(after?.body).toContain('categoria: "21 Productos de software"');
    expect(after?.body).toContain('area: "20-29 Productos"');
    // La clave ajena, intacta.
    expect(after?.body).toContain('propia: dato personal');
    expect(after?.body).toContain('tipo: cabecera');
  });

  it('con `chosenPaths` que no incluye la nota, no escribe nada', async () => {
    const { index, notePath, body } = fixture();
    const frontmatter = { jd: 21.2, tipo: 'cabecera' };
    const findings = auditSystem({
      index,
      notes: [{ path: notePath, frontmatter, body }],
      filePaths: [notePath]
    });
    const library = new FakeJdexVault();
    library.seedNote(fakeNote('note-1', 'f-jdex', body));
    const result = await applyJdexFrontmatterFixes(library, markdown, findings, () => 'note-1', new Set());
    expect(result.written).toHaveLength(0);
    expect((await library.noteRead('note-1'))?.body).toBe(body);
  });

  it('sin id de nota (`noteIdByPath` da null), no escribe', async () => {
    const { index, notePath, body } = fixture();
    const frontmatter = { jd: 21.2, tipo: 'cabecera' };
    const findings = auditSystem({
      index,
      notes: [{ path: notePath, frontmatter, body }],
      filePaths: [notePath]
    });
    const library = new FakeJdexVault();
    const result = await applyJdexFrontmatterFixes(library, markdown, findings, () => null);
    expect(result.written).toHaveLength(0);
  });
});

// `expectedFrontmatter` ya se prueba en el motor (vendor): esta comprobación es solo
// de cableado, para que un cambio de firma no pase desapercibido aquí.
describe('expectedFrontmatter (cableado)', () => {
  it('un ID de cabecera exige jd y tipo: cabecera', () => {
    const { index, parsed } = fixture();
    const expected = expectedFrontmatter(index, parsed.number, '21.20 Cabecera');
    expect(expected.jd).toBe('21.20');
    expect(expected.tipo).toBe('cabecera');
  });
});
