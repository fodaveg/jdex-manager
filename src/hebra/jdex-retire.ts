/**
 * «Retirar un ID» (lote 3, tarea 2, encargo de David, 28 sep 2026): el motor puro
 * (`retirePlan`, `vendor/jdex-manager/src/jd/retire.ts`) ya calcula el plan entero
 * — el número NUNCA se renumera ni se reutiliza (johnnydecimal.com), solo se marca
 * `tipo: archivado` con la fecha en la nota JDex del ID y, si tiene carpeta, se
 * mueve dentro de la `.09` (archivo) de su categoría con la fecha delante del
 * nombre. Este fichero es el adaptador: lee y escribe por los puertos de la
 * biblioteca (`api.vault`: `notesRewriteBatch` para el frontmatter y la línea «Retirado
 * el…», `folderRename`+`folderMove` para el traslado).
 */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import { insertAfterH1, retirePlan, type IdEntry, type JdIndex, type RetirePlan } from './engine';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';
import { rewriteJdexNotes, type JdexRewriteLibrary } from './jdex-write';

export type JdexRetireLibrary = JdexRewriteLibrary &
  Pick<PluginVault, 'folderRenameIfUnchanged' | 'folderMoveIfUnchanged'>;

export interface JdexRetireOutcome {
  plan: RetirePlan;
  /** `true` si la carpeta del ID se movió a la `.09`; `false` sin carpeta o sin
   *  archivo válido (`plan.moveProblem` dice por qué). */
  moved: boolean;
}

function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Aplica el `RetirePlan` de `entry`: primero la nota (frontmatter + línea, siempre),
 *  después la carpeta (renombrar con la fecha delante, luego mover a la `.09`), si el
 *  plan trae `move`. Lanza si `entry` no tiene nota JDex (`retirePlan` lo comprueba). */
export async function retireJdexId(
  library: JdexRetireLibrary,
  markdown: Pick<PluginMarkdown, 'setProperty' | 'frontmatter'>,
  walk: JdexLibraryWalk,
  index: JdIndex,
  entry: IdEntry,
  date: string
): Promise<JdexRetireOutcome> {
  const noteId = entry.notePath ? walk.noteIdByPath?.get(entry.notePath) ?? walk.systemNotes.find((note) => note.path === entry.notePath)?.id : undefined;
  if (!noteId) throw new Error(`No se encontró la nota JDex de ${entry.label} en la biblioteca.`);
  const current = await library.noteRead(noteId);
  if (!current || current.body === null) throw new Error(`La nota JDex de ${entry.label} no está disponible para retirar.`);
  const frontmatter = markdown.frontmatter(current.body);
  const archivedAt = frontmatter?.tipo === 'archivado'
    ? typeof frontmatter.archivado === 'string' ? frontmatter.archivado : ''
    : undefined;
  const plan = retirePlan(index, entry, date, undefined, archivedAt);
  if ('error' in plan) throw new Error(plan.error);
  const result = await rewriteJdexNotes(
    library,
    [noteId],
    (current) => {
      if (markdown.frontmatter(current.body)?.tipo === 'archivado') return null;
      let next = current.body;
      for (const [key, value] of Object.entries(plan.frontmatter)) {
        next = markdown.setProperty(next, key, value);
      }
      next = insertAfterH1(next, plan.line);
      return next === current.body ? null : next;
    },
    'Antes de retirar el ID'
  );
  if (!result.written.includes(noteId)) throw new Error(`No se pudo marcar ${entry.label} como retirado: la nota está bloqueada, obsoleta o no se escribió.`);

  let moved = false;
  if (plan.move) {
    const folderId = jdexResolveFolderId(walk, plan.move.from);
    const archiveFolderId = jdexResolveFolderId(walk, parentPath(plan.move.to));
    if (!folderId || !archiveFolderId) throw new Error('No se encontró la carpeta o el archivo; la nota marcada queda en el diario.');
    {
      const originalName = baseName(plan.move.from);
      const originalParentId = jdexResolveFolderId(walk, parentPath(plan.move.from));
      const renamed = await library.folderRenameIfUnchanged(folderId, baseName(plan.move.to), { name: originalName, parentId: originalParentId });
      if (!renamed) throw new Error('La carpeta cambió antes de retirarla; se conserva la nota marcada en el diario.');
      const expected = { name: renamed.name, parentId: renamed.parentId };
      try {
        if (!await library.folderMoveIfUnchanged(folderId, archiveFolderId, expected)) throw new Error('La carpeta cambió antes de moverla.');
      } catch (error) {
        try {
          if (!await library.folderRenameIfUnchanged(folderId, originalName, expected)) throw new Error('La carpeta cambió; se conserva su estado actual.');
        } catch (rollbackError) {
          throw new Error(`Falló el movimiento y no se pudo revertir el nombre de la carpeta: ${String(rollbackError)}. Causa: ${String(error)}`);
        }
        throw new Error(`Falló el movimiento; comprueba la carpeta antes de reintentar. ${String(error)}`);
      }
      moved = true;
    }
  }

  return { plan, moved };
}
