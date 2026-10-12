import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { resolveJdexTemplate } from '../../src/hebra/jdex-create-write';
import { jdexTemplatesOutcomeMessage, writeJdexBuiltinTemplates } from '../../src/hebra/jdex-templates';
import type { JdexLibraryWalk, JdexNoteRef } from '../../src/hebra/library-index';
import { FakeJdexVault } from './support/fakes';

const markdown = createFakePluginApi().api.markdown;
const TEMPLATES = '00-09 Sistema/00 Sistema/00.03 Plantillas';

function walkWith(notes: JdexNoteRef[] = []): JdexLibraryWalk {
  const folderPaths = new Map([['f-templates', TEMPLATES]]);
  return { rootFolderId: 'root', folderPaths, systemFolderPaths: [...folderPaths.values()], systemNotes: notes };
}

const settings = { ...DEFAULT_SETTINGS, templatesFolder: TEMPLATES };

describe('writeJdexBuiltinTemplates (263b284a)', () => {
  it('writes the four built-in templates with their configured names, and resolveJdexTemplate finds them', async () => {
    const library = new FakeJdexVault();
    const named = { ...settings, templateNames: { ...settings.templateNames, id: 'Mi plantilla de ID' } };
    const outcome = await writeJdexBuiltinTemplates(library, markdown, walkWith(), named);
    expect(outcome.created).toEqual(['Mi plantilla de ID', 'JDex - cabecera', 'JDex - categoria', 'JDex - area']);
    expect(outcome.existing).toEqual([]);
    const written = (await Promise.all([1, 2, 3, 4].map((n) => library.noteRead(`fake-note-${n}`)))).filter((note) => note !== null);
    expect(written.map((note) => [note.title, note.folderId])).toEqual(outcome.created.map((name) => [name, 'f-templates']));
    // The editable copy is the template from now on.
    const refs = written.map((note) => ({ id: note.id, folderId: note.folderId, title: note.title, path: `${TEMPLATES}/${note.title}.md` }));
    const resolved = await resolveJdexTemplate(library, walkWith(refs), named, 'id');
    expect(resolved).toBe(written[0].body);
    expect(resolved).not.toBe(BUILTIN_TEMPLATES.id);
    expect(resolved).toContain('jd: "{{id}}"');
  });

  it('never overwrites a template that already exists', async () => {
    const library = new FakeJdexVault();
    const existing: JdexNoteRef = { id: 'n-mine', folderId: 'f-templates', title: 'JDex - id', path: `${TEMPLATES}/JDex - id.md` };
    const outcome = await writeJdexBuiltinTemplates(library, markdown, walkWith([existing]), settings);
    expect(outcome.existing).toEqual(['JDex - id']);
    expect(outcome.created).toEqual(['JDex - cabecera', 'JDex - categoria', 'JDex - area']);
    expect(jdexTemplatesOutcomeMessage(outcome)).toBe('Plantillas escritas: JDex - cabecera, JDex - categoria, JDex - area; ya existían (sin tocar): JDex - id.');
  });

  it('without a configured or existing templates folder it writes nothing and says why', async () => {
    const library = new FakeJdexVault();
    await expect(writeJdexBuiltinTemplates(library, markdown, walkWith(), DEFAULT_SETTINGS)).rejects.toThrow(/no está configurada/);
    await expect(writeJdexBuiltinTemplates(library, markdown, walkWith(), { ...settings, templatesFolder: 'No existe' })).rejects.toThrow(/no existe/);
    expect(await library.noteRead('fake-note-1')).toBeNull();
  });
});
