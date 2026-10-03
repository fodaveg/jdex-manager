/**
 * Reescritura en lote de notas JDex ya existentes, compartida por «normalizar el
 * frontmatter» (tarea 2) y «cabeceras e índice al día» (tarea 3): lee, calcula el
 * cuerpo siguiente con una función PURA y escribe con `vault.notesRewriteBatch`, nunca
 * `noteSave` — una base que cambió entre medias se relee y se reintenta, en vez de
 * crear una copia de conflicto (mismo motivo que `TyrianVault.process` y el mismo
 * patrón de reintento que `prop-rename.ts` de Hebra).
 *
 * Hebra deriva el título dentro de `notesRewriteBatch` conservando el guardado cuando el
 * cuerpo nuevo no da ninguno (`deriveNoteKeepingTitle`): el plugin ya no lo calcula.
 */
import type { PluginNote, PluginNoteRewrite, PluginVault } from 'hebra-plugin-api';

/** Lo que usa este fichero del `vault` de la API. */
export type JdexRewriteLibrary = Pick<PluginVault, 'noteRead' | 'notesRewriteBatch'>;

/** La nota que recibe `nextBody`: su id y su cuerpo (una nota protegida no llega). */
export interface JdexNoteBody {
  readonly id: string;
  readonly body: string;
}

/** El primer intento y UN reintento releyendo la nota que salió `stale` (como
 *  `prop-rename.ts`, `REWRITE_ATTEMPTS`). */
const REWRITE_ATTEMPTS = 2;

/**
 * Reescribe cada nota de `ids` con `nextBody(current)`: `null` o el mismo cuerpo =
 * sin cambios, no se escribe (así «sin marcadores, no se toca» del contrato del 28 sep
 * es gratis: la función pura de quien llama devuelve `null`). `cause` deja una
 * instantánea de «Versiones anteriores» cuando SÍ cambia, como el resto de reescrituras
 * en lote de la app. Una nota protegida (`locked`, sin cuerpo) no se toca nunca.
 */
export async function rewriteJdexNotes(
  library: JdexRewriteLibrary,
  ids: readonly string[],
  nextBody: (current: JdexNoteBody) => string | null,
  cause?: string | null
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  let pending = ids;
  for (let attempt = 0; attempt < REWRITE_ATTEMPTS && pending.length > 0; attempt += 1) {
    const entries: PluginNoteRewrite[] = [];
    for (const id of pending) {
      const note: PluginNote | null = await library.noteRead(id);
      if (!note) continue; // Purgada entre medias: nada que reescribir.
      if (note.body === null) continue; // Protegida: el plugin nunca la reescribe.
      const body = nextBody({ id, body: note.body });
      if (body === null || body === note.body) continue;
      entries.push({ id, body, expected: note.revision });
    }
    if (entries.length === 0) return { written, skipped };
    const result = await library.notesRewriteBatch(entries, { cause: cause ?? null });
    written.push(...result.written);
    pending = result.stale;
  }
  skipped.push(...pending);
  return { written, skipped };
}
