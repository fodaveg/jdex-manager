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
  Pick<PluginVault, 'folderRename' | 'folderMove'>;

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
  markdown: Pick<PluginMarkdown, 'setProperty'>,
  walk: JdexLibraryWalk,
  index: JdIndex,
  entry: IdEntry,
  date: string
): Promise<JdexRetireOutcome> {
  const plan = retirePlan(index, entry, date);
  if ('error' in plan) throw new Error(plan.error);

  const noteId = walk.systemNotes.find((note) => note.path === plan.notePath)?.id;
  if (!noteId) throw new Error(`No se encontró la nota JDex de ${plan.id} en la biblioteca.`);
  await rewriteJdexNotes(
    library,
    [noteId],
    (current) => {
      let next = current.body;
      for (const [key, value] of Object.entries(plan.frontmatter)) {
        next = markdown.setProperty(next, key, value);
      }
      next = insertAfterH1(next, plan.line);
      return next === current.body ? null : next;
    },
    'Antes de retirar el ID'
  );

  let moved = false;
  if (plan.move) {
    const folderId = jdexResolveFolderId(walk, plan.move.from);
    const archiveFolderId = jdexResolveFolderId(walk, parentPath(plan.move.to));
    if (folderId && archiveFolderId) {
      await library.folderRename(folderId, baseName(plan.move.to));
      await library.folderMove(folderId, archiveFolderId);
      moved = true;
    }
  }

  return { plan, moved };
}
