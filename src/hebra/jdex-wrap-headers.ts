/**
 * «JDex: envolver las listas de cabeceras en marcadores» (tarea 3 del lote, comando de
 * migración con vista previa que pide el encargo): una cabecera cuyo cuerpo aún no
 * tiene `<!-- jdex:hijos -->` no se toca en el resto de este lote — este comando es la
 * única vía para dárselos, envolviendo su primera lista de `- [[enlace]]` contigua
 * (`wrapFirstLinkList`, el mismo criterio que el plugin de Obsidian).
 */
import { headerEntries, wrapFirstLinkList, type JdIndex } from './engine';
import { rewriteJdexNotes, type JdexRewriteLibrary } from './jdex-write';
import type { JdexLibraryWalk } from './library-index';

export interface JdexWrapCandidate {
  readonly noteId: string;
  readonly path: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** Cabeceras con nota, SIN marcadores, cuyo cuerpo tiene al menos una lista de enlaces
 *  que envolver (`wrapFirstLinkList` no da `null`). */
export function findJdexWrapCandidates(
  walk: JdexLibraryWalk,
  index: JdIndex,
  bodyOf: (noteId: string) => string | null
): JdexWrapCandidate[] {
  const out: JdexWrapCandidate[] = [];
  for (const header of headerEntries(index)) {
    if (!header.notePath) continue;
    const ref = walk.systemNotes.find((note) => note.path === header.notePath);
    if (!ref) continue;
    const before = bodyOf(ref.id);
    if (before === null) continue;
    const after = wrapFirstLinkList(before);
    if (after === null) continue;
    out.push({ noteId: ref.id, path: header.notePath, label: header.label, before, after });
  }
  return out;
}

/** Aplica el envoltorio a los candidatos de `noteIds` (los marcados en la vista
 *  previa). Sin ellos, no escribe nada. */
export async function applyJdexWrap(
  library: JdexRewriteLibrary,
  candidates: readonly JdexWrapCandidate[],
  noteIds: readonly string[]
): Promise<{ written: string[]; skipped: string[] }> {
  const chosen = new Set(noteIds);
  const byId = new Map(candidates.map((c) => [c.noteId, c] as const));
  const ids = candidates.filter((c) => chosen.has(c.noteId)).map((c) => c.noteId);
  return rewriteJdexNotes(library, ids, (current) => byId.get(current.id)?.after ?? null);
}
