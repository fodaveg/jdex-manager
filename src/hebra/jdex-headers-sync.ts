/**
 * Cabeceras vivas y el índice del sistema, al día solos (tarea 3 del lote, 28 sep
 * 2026): tras crear un ID o recibir cambios manuales del sistema desde Hebra, releer las
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
  return walk.noteIdByPath?.get(path) ?? walk.systemNotes.find((note) => note.path === path)?.id ?? null;
}

/** Reescribe el bloque de hijos de las cabeceras con nota y marcadores.
 *  Los cuerpos sin marcadores o ya actualizados no se escriben. */
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
 *  después de una creación propia o de un cambio manual en la JDex. Los bloques ya
 *  actualizados no se escriben, así que los avisos del propio refresco terminan sin bucle. */
export async function refreshJdexHeadersAndIndex(
  library: JdexRewriteLibrary,
  walk: JdexLibraryWalk,
  index: JdIndex,
  systemIndexNote: string
): Promise<{ written: string[]; skipped: string[] }> {
  const headers = await refreshJdexHeaders(library, walk, index);
  const system = await refreshJdexSystemIndex(library, walk, index, systemIndexNote);
  return { written: [...headers.written, ...system.written], skipped: [...headers.skipped, ...system.skipped] };
}
