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
import type { PluginNote, PluginNoteRewrite, PluginVault } from 'hebra-plugin-api/v2';
import { JdexJournalSaveError } from './jdex-journal';

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
 * Host limit: Hebra rejects a `notesRewriteBatch` with more than 200 entries with
 * `invalid-argument` (`NOTES_REWRITE_BATCH_MAX`, `hebra/src/lib/library/types.ts`,
 * checked in `plugins/api/vault-facade.ts`). It counts the notes that need a write,
 * not every note of the JDex, so larger rewrites are split into batches of this size.
 */
export const JDEX_REWRITE_BATCH_MAX = 200;

/**
 * A batch failed after earlier batches of the same rewrite were already written.
 * `written` lists them (they are in the journal of the running operation, so «Deshacer
 * la última operación» reverts them); `unwritten` lists the notes that were not written.
 */
export class JdexPartialRewriteError extends Error {
  readonly written: readonly string[];
  readonly unwritten: readonly string[];
  constructor(written: readonly string[], unwritten: readonly string[], cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      // A journal that could not be saved is the cause: the last batch may even have been
      // written, and nothing is undoable after a close until the journal is saved again.
      cause instanceof JdexJournalSaveError
        ? `Se escribieron al menos ${written.length} nota(s) antes del fallo y ${unwritten.length} quedaron sin confirmar. ` +
            `El diario de deshacer no se pudo guardar: lo escrito sigue en el diario en memoria y se guardará con el próximo cambio; si cierras Hebra antes, no se podrá deshacer. Causa: ${reason}`
        : `Se escribieron ${written.length} nota(s) antes del fallo y ${unwritten.length} quedaron sin escribir. ` +
            `Lo escrito queda en el diario y se puede deshacer. Causa: ${reason}`
    );
    this.name = 'JdexPartialRewriteError';
    this.written = written;
    this.unwritten = unwritten;
  }
}

/**
 * Reescribe cada nota de `ids` con `nextBody(current)`: `null` o el mismo cuerpo =
 * sin cambios, no se escribe (así «sin marcadores, no se toca» del contrato del 28 sep
 * es gratis: la función pura de quien llama devuelve `null`). `cause` deja una
 * instantánea de «Versiones anteriores» cuando SÍ cambia, como el resto de reescrituras
 * en lote de la app. Una nota protegida (`locked`, sin cuerpo) no se toca nunca.
 *
 * The writes go in batches of `JDEX_REWRITE_BATCH_MAX`. Run inside `journal.run`, every
 * batch lands in the same journal operation, so the whole rewrite is one undo entry.
 * If a later batch throws, `JdexPartialRewriteError` says what was already written.
 */
export async function rewriteJdexNotes(
  library: JdexRewriteLibrary,
  ids: readonly string[],
  nextBody: (current: JdexNoteBody) => string | null,
  cause?: string | null
): Promise<{ written: string[]; skipped: string[]; held?: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  /** Held back by the journal (an automatic run over what an undo restored): skipped
   *  without a retry, and without the «changed meanwhile» warning. */
  const held: string[] = [];
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
    if (entries.length === 0) return held.length > 0 ? { written, skipped: [...skipped, ...held], held } : { written, skipped };
    const stale: string[] = [];
    for (let from = 0; from < entries.length; from += JDEX_REWRITE_BATCH_MAX) {
      const batch = entries.slice(from, from + JDEX_REWRITE_BATCH_MAX);
      let result: Awaited<ReturnType<JdexRewriteLibrary['notesRewriteBatch']>>;
      try {
        result = await library.notesRewriteBatch(batch, { cause: cause ?? null });
      } catch (error) {
        // Nothing written yet in this rewrite: the original error is clearer as is.
        if (written.length === 0) throw error;
        const done = new Set(written);
        const unwritten = [...stale, ...entries.slice(from).map((entry) => entry.id)].filter((id) => !done.has(id));
        throw new JdexPartialRewriteError([...written], unwritten, error);
      }
      written.push(...result.written);
      stale.push(...result.stale);
      held.push(...((result as { held?: string[] }).held ?? []));
    }
    pending = stale;
  }
  skipped.push(...pending, ...held);
  return held.length > 0 ? { written, skipped, held } : { written, skipped };
}
