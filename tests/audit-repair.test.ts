import { describe, expect, it } from 'vitest';
import { auditSystem, type AuditInput } from '../src/jd/audit';
import { buildIndex } from '../src/jd/index';

const area = '20-29 Productos';
const category = `${area}/21 Software`;
const inbox = `${category}/21.01 Inbox`;

function audit(folderPaths: string[], notePaths: string[], extra: Partial<AuditInput> = {}) {
  const index = buildIndex({ systemRoot: '', jdexFolder: 'JDex', folderPaths: [area, category, inbox, ...folderPaths], notePaths });
  return auditSystem({ index, jdexFolder: 'JDex', folderPaths: [area, category, inbox, ...folderPaths], notes: [], filePaths: notePaths, ...extra });
}

describe('unified repair proposals', () => {
  it('creates a missing JDex note from the numbered folder title', () => {
    expect(audit([`${category}/21.22 Proyecto`], []).find((f) => f.kind === 'folder-without-note' && f.number === '21.22')?.fix).toEqual({
      type: 'create-note', path: 'JDex/21.22 Proyecto.md', number: '21.22', title: 'Proyecto', kind: 'id', category: '21'
    });
  });

  it('creates a missing ID folder with the category pattern', () => {
    expect(audit([], ['JDex/21.22 Proyecto.md'], { patternFor: () => ['40 Audits', '70 Adjuntos'] })
      .find((f) => f.kind === 'note-without-folder')?.fix).toEqual({
        type: 'create-folder', path: `${category}/21.22 Proyecto`,
        paths: [`${category}/21.22 Proyecto`, `${category}/21.22 Proyecto/40 Audits`, `${category}/21.22 Proyecto/70 Adjuntos`]
      });
  });

  it('moves all reserved and header content to the category inbox', () => {
    const reserved = `${category}/21.02 Gestión`;
    const header = `${category}/21.20 ■ Grupo`;
    const first = `${reserved}/uno.pdf`;
    const second = `${reserved}/dos.pdf`;
    const third = `${header}/contenido.txt`;
    const findings = audit([reserved, header], [], { filePaths: [first, second, third] });
    expect(findings.find((f) => f.kind === 'reserved-used-as-content')?.fix).toEqual({ type: 'move', items: [
      { from: first, to: `${inbox}/uno.pdf` }, { from: second, to: `${inbox}/dos.pdf` }
    ] });
    expect(findings.find((f) => f.kind === 'header-with-files')?.fix).toEqual({ type: 'move', items: [{ from: third, to: `${inbox}/contenido.txt` }] });
  });

  it('only proposes a trash when the duplicate is visibly a conflict copy with identical body', () => {
    const original = 'JDex/21.22 Proyecto.md';
    const copy = 'JDex/21.22 Proyecto (conflicted copy).md';
    const run = (body: string) => audit([], [original, copy], { notes: [
      { path: original, frontmatter: null, body: 'mismo cuerpo' },
      { path: copy, frontmatter: null, body }
    ] }).find((f) => f.kind === 'duplicate-id');
    expect(run('mismo cuerpo')?.fix).toEqual({ type: 'trash', path: copy, identicalTo: original });
    expect(run('distinto')?.fix).toBeUndefined();
  });

  it('moves an out-of-parent ID only when its true category exists and is free', () => {
    const wrong = `${area}/22 Otra/21.22 Proyecto`;
    const findings = audit([`${area}/22 Otra`, wrong], []);
    expect(findings.find((f) => f.kind === 'out-of-parent')?.fix).toEqual({ type: 'move', items: [
      { from: wrong, to: `${category}/21.22 Proyecto` }
    ] });
    expect(audit([`${area}/22 Otra`, wrong, `${category}/21.22 Proyecto`], [])
      .find((f) => f.kind === 'out-of-parent')?.fix).toBeUndefined();
  });
});
