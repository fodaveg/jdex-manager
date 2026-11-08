/**
 * Puerta de concurrencia para las `noteRead` del plugin (tarea Lumbre 35c8fc55).
 *
 * Diagnóstico real del Mac (7 nov 2026, sesión 4f42ca0a, 193 min): el consumidor jdex hizo
 * 235 de las 359 `note_read` de Hebra, con picos de 98 lecturas concurrentes en un minuto.
 * Todas las lecturas pasan por la cola única del almacén y se esperan entre sí (660 ms
 * de espera acumulada frente a 18 ms de ejecución), retrasando al resto de la app. El plugin
 * lanzaba esas ráfagas sobre todo desde el diario (`jdex-journal.ts`: un `Promise.all` de
 * `noteRead` por cada lote de reescritura), pero cualquier consumidor vale.
 *
 * Aquí TODAS las `noteRead` del plugin pasan por un semáforo FIFO de como máximo
 * `MAX_CONCURRENT_NOTE_READS` lecturas a la vez: una ráfaga de 98 entra en la cola nativa de
 * cuatro en cuatro, no las 98 a la vez. `activateJdex` envuelve el `api` entero con
 * `gatePluginApiNoteReads`, así que journal, adaptadores y vistas quedan cubiertos sin tocar
 * cada llamada.
 */
import type { HebraPluginApi, PluginNote, PluginVault } from 'hebra-plugin-api/v2';

/**
 * Tope de `noteRead` concurrentes que el plugin deja pasar a la cola nativa del almacén.
 * Con 4, el pico medido de 98 lecturas baja a 4 (unas 25 veces menos presión sobre la cola)
 * sin serializar por completo las lecturas (~18 ms de ejecución cada una: las 235 lecturas
 * del diagnóstico habrían tardado ~1,1 s con tope 4 frente a ~4,2 s con tope 1).
 */
export const MAX_CONCURRENT_NOTE_READS = 4;

/** Ejecuta `task` cuando la puerta deja sitio; las que esperan se atienden en FIFO. */
export type ReadGate = <T>(task: () => Promise<T>) => Promise<T>;

/** Semáforo FIFO de `maxConcurrent` ejecuciones a la vez (mínimo 1). Un rechazo también
 *  libera su hueco. */
export function createReadGate(maxConcurrent: number = MAX_CONCURRENT_NOTE_READS): ReadGate {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const waiting: (() => void)[] = [];
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active += 1;
        const release = (): void => {
          active -= 1;
          waiting.shift()?.();
        };
        task().then(
          (value) => {
            release();
            resolve(value);
          },
          (error: Error) => {
            release();
            reject(error);
          }
        );
      };
      if (active < limit) run();
      else waiting.push(run);
    });
}

/** Vincula una propiedad de un objeto al propio objeto (los métodos de clase pierden el
 *  `this` si se leen a través de un Proxy). */
function boundProperty<T extends object>(target: T, property: string | symbol): unknown {
  const value = Reflect.get(target, property, target) as unknown;
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
}

/**
 * Devuelve `vault` con la `noteRead` pasando por la puerta de concurrencia; el resto de
 * métodos queda intacto (mismos valores, mismo `this`).
 */
export function gateVaultNoteReads<T extends PluginVault>(vault: T, maxConcurrent: number = MAX_CONCURRENT_NOTE_READS): T {
  const gate = createReadGate(maxConcurrent);
  // El Proxy envuelve un objeto vacío, no `vault`: la fachada del host está congelada (`Object.freeze`)
  // y un `get` que devuelve otro valor que una propiedad congelada lanza `TypeError`.
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === 'noteRead') {
        return (id: string): Promise<PluginNote | null> => gate(() => vault.noteRead(id));
      }
      return boundProperty(vault, property);
    }
  });
}

/** Tope de ids por operación de lectura por lotes (el del host, como `noteSummary`). */
export const NOTES_READ_BATCH_MAX = 200;

/** Lo que `readNotes` pide del vault: `noteRead` siempre; `notesReadBatch` si el host la tiene
 *  (capacidad `vault.read.batch` de la API de Hebra, aún no en todas). */
export interface BatchReadCapable {
  noteRead(id: string): Promise<PluginNote | null>;
  notesReadBatch?(ids: readonly string[]): Promise<readonly (PluginNote | null)[]>;
}

/**
 * Lee varias notas de golpe y devuelve `id → nota` (`null` si no existe). Con la capacidad
 * `vault.read.batch` del host usa `notesReadBatch` en lotes de `NOTES_READ_BATCH_MAX` —una
 * operación de la cola del almacén por lote, en vez de una por nota—; sin ella, `noteRead` por
 * id (que pasa por la puerta de concurrencia si `vault` es el envuelto con `gateVaultNoteReads`).
 */
export async function readNotes(vault: BatchReadCapable, ids: readonly string[]): Promise<Map<string, PluginNote | null>> {
  const out = new Map<string, PluginNote | null>();
  if (ids.length === 0) return out;
  if (typeof vault.notesReadBatch === 'function') {
    for (let start = 0; start < ids.length; start += NOTES_READ_BATCH_MAX) {
      const slice = ids.slice(start, start + NOTES_READ_BATCH_MAX);
      const rows = await vault.notesReadBatch(slice);
      slice.forEach((id, index) => out.set(id, rows[index] ?? null));
    }
    return out;
  }
  await Promise.all(ids.map(async (id) => out.set(id, await vault.noteRead(id))));
  return out;
}

/**
 * Envuelve el `api` del plugin para que todo `api.vault.noteRead` que use el runtime pase por
 * la puerta; el resto del api queda tal cual.
 */
export function gatePluginApiNoteReads(api: HebraPluginApi, maxConcurrent: number = MAX_CONCURRENT_NOTE_READS): HebraPluginApi {
  const gated = gateVaultNoteReads(api.vault, maxConcurrent);
  // La fachada del host expone `notesReadBatch` siempre (es una llamada RPC); solo vale si la
  // capacidad `vault.read.batch` está declarada y el host la sirve. Si no, se oculta y
  // `readNotes` cae a `noteRead` por la puerta.
  const vault = api.has('vault.read.batch')
    ? gated
    : new Proxy({} as PluginVault, {
        get(_target, property) {
          return property === 'notesReadBatch' ? undefined : boundProperty(gated, property);
        }
      });
  return new Proxy({} as HebraPluginApi, {
    get(_target, property) {
      if (property === 'vault') return vault;
      return boundProperty(api, property);
    }
  });
}
