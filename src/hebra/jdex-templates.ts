/**
 * «Escribir plantillas integradas» (audit of 12 Oct 2026, finding 4): the Hebra twin of
 * Obsidian's «Create JDex templates in the templates folder». Writes the four built-in
 * templates (`BUILTIN_TEMPLATES`) into `templatesFolder`, each titled with its configured
 * name (`templateNames`), so `resolveJdexTemplate` finds them and the user can edit them.
 * A note that already has that name in the folder is never touched.
 */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import { BUILTIN_TEMPLATES, TEMPLATE_TYPES, type JdexManagerSettings } from './engine';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

export interface JdexTemplatesOutcome {
  /** Names written now. */
  readonly created: readonly string[];
  /** Names that already existed and were left as they were. */
  readonly existing: readonly string[];
}

export async function writeJdexBuiltinTemplates(
  library: Pick<PluginVault, 'noteCreate'>,
  markdown: Pick<PluginMarkdown, 'withTitle'>,
  walk: JdexLibraryWalk,
  settings: Pick<JdexManagerSettings, 'templatesFolder' | 'templateNames'>
): Promise<JdexTemplatesOutcome> {
  if (settings.templatesFolder === '') {
    throw new Error('La carpeta de plantillas no está configurada (Ajustes › Módulos › JDex Manager).');
  }
  const folderId = jdexResolveFolderId(walk, settings.templatesFolder);
  if (folderId === null) throw new Error(`La carpeta de plantillas («${settings.templatesFolder}») no existe.`);
  const created: string[] = [];
  const existing: string[] = [];
  for (const type of TEMPLATE_TYPES) {
    const name = settings.templateNames[type];
    if (walk.systemNotes.some((note) => note.folderId === folderId && note.title === name)) {
      existing.push(name);
      continue;
    }
    const body = markdown.withTitle(BUILTIN_TEMPLATES[type], name);
    // Without the title the note would be named after its `{{id}} {{title}}` heading and
    // `resolveJdexTemplate` would never find it.
    if (body === BUILTIN_TEMPLATES[type]) throw new Error(`No se pudo poner el título «${name}» a la plantilla.`);
    await library.noteCreate({ folderId, body });
    created.push(name);
  }
  return { created, existing };
}

/** One line for the notice: what was written and what was already there. */
export function jdexTemplatesOutcomeMessage(outcome: JdexTemplatesOutcome): string {
  const parts: string[] = [];
  if (outcome.created.length > 0) parts.push(`Plantillas escritas: ${outcome.created.join(', ')}`);
  if (outcome.existing.length > 0) parts.push(`ya existían (sin tocar): ${outcome.existing.join(', ')}`);
  return parts.length === 0 ? 'No hay plantillas que escribir.' : `${parts.join('; ')}.`;
}
