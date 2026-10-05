/**
 * Cabeceras vivas y el índice del sistema, al día solos (tarea 3 del lote, 28 sep
 * 2026): tras crear (o, en un lote posterior, renombrar) un ID desde Hebra, releer las
 * notas cabecera del sistema y reescribir su lista de hijos entre `<!-- jdex:hijos -->`
 * y `<!-- /jdex:hijos -->` (`childrenOf`, `renderChildren`, `replaceChildrenBlock`), y
 * la nota del `00.00` (o `systemIndexNote`, si está configurada) entre
 * `<!-- jdex:indice -->` y `<!-- /jdex:indice -->` (`renderSystemIndex`,
 * `replaceSystemIndex`). Una nota sin marcadores NO se toca (contrato del 28 sep,
 * punto 4): para esas, `wrapFirstLinkList` — ver `jdex-wrap-headers.ts`.
 */
import {
  childrenOf,
  headerEntries,
  renderChildren,
  renderSystemIndex,
  replaceChildrenBlock,
  replaceSystemIndex,
  type JdIndex
} from './engine';
import { rewriteJdexNotes, type JdexRewriteLibrary } from './jdex-write';
import type { JdexLibraryWalk } from './library-index';

function noteIdOf(walk: JdexLibraryWalk, path: string | undefined): string | null {
  if (!path) return null;
  return walk.systemNotes.find((note) => note.path === path)?.id ?? null;
}

/** Reescribe el bloque de hijos de TODAS las cabeceras del índice que tengan nota. Las
 *  que no tienen marcadores salen en `skipped` sin tocarse (`rewriteJdexNotes` con
 *  `nextBody` devolviendo `null`). */
export async function refreshJdexHeaders(
  library: JdexRewriteLibrary,
  walk: JdexLibraryWalk,
  index: JdIndex
): Promise<{ written: string[]; skipped: string[] }> {
  const headers = headerEntries(index);
  const byId = new Map<string, (typeof headers)[number]>();
  for (const header of headers) {
    const id = noteIdOf(walk, header.notePath);
    if (id) byId.set(id, header);
  }
  return rewriteJdexNotes(library, [...byId.keys()], (current) => {
    const header = byId.get(current.id);
    if (!header) return null;
    return replaceChildrenBlock(current.body, renderChildren(childrenOf(index, header.id, header.system)));
  });
}

/** La nota del índice del sistema: `systemIndexNote` si está configurada, si no la del
 *  ID `00.00` (contrato del 28 sep, `DEFAULT_SETTINGS.systemIndexNote` vacío). Sin nota
 *  o sin marcadores, no hace nada. */
export async function refreshJdexSystemIndex(
  library: JdexRewriteLibrary,
  walk: JdexLibraryWalk,
  index: JdIndex,
  systemIndexNote: string
): Promise<{ written: string[]; skipped: string[] }> {
  const path =
    systemIndexNote !== '' ? systemIndexNote : index.ids.find((e) => e.id === '00.00')?.notePath;
  const id = noteIdOf(walk, path);
  if (!id) return { written: [], skipped: [] };
  return rewriteJdexNotes(library, [id], (current) =>
    replaceSystemIndex(current.body, renderSystemIndex(index))
  );
}

/** Las dos reescrituras de esta tarea, en una llamada: lo que ejecuta `jdex-runtime.ts`
 *  después de cada creación propia (nunca tras un `rebuild` genérico por cambios
 *  ajenos: el contrato solo pide «tras crear o renombrar un ID desde Hebra»). */
export async function refreshJdexHeadersAndIndex(
  library: JdexRewriteLibrary,
  walk: JdexLibraryWalk,
  index: JdIndex,
  systemIndexNote: string
): Promise<void> {
  await refreshJdexHeaders(library, walk, index);
  await refreshJdexSystemIndex(library, walk, index, systemIndexNote);
}
