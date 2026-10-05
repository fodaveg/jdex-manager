/**
 * Validación pura de «crear ID / cabecera / hijo (+)» (tarea 1 del lote, 28 sep 2026):
 * mismo comportamiento que `vendor/jdex-manager/src/ui/create-id.ts` y
 * `create-structure.ts` (`validateNewId`, `CreateHeaderModal.validate`,
 * `CreateChildModal.validate`), reimplementado aquí porque esos ficheros importan
 * `obsidian` (el contrato del 28 sep dice que no se importan, solo se leen para copiar
 * el comportamiento). `validateNewCategory` y `parseNewArea` SÍ son puros en el motor
 * (`structure.ts`) y se usan tal cual desde `./engine`, sin copia.
 *
 * Sin biblioteca: solo el índice ya calculado y lo que teclea el usuario. Lo que
 * escribe (plantilla, nota, carpeta) vive en `./jdex-create-write.ts`.
 */
import { findId, isReserved, parseJdNumber, sameSystem, titleForCompare, jdexNoteName, type IdEntry, type JdIndex } from './engine';

/** Por qué el número de ID tecleado no se puede usar, o `null` si vale (copia
 *  `CreateIdModal.currentError` del plugin, menos el título, que valida
 *  `validateNewTitle`). */
export function validateNewId(index: JdIndex, category: string, raw: string, system = index.system ?? ''): string | null {
  const n = parseJdNumber(raw);
  if (!n || n.kind !== 'id') return 'Escribe un ID como 21.23.';
  if (n.system && n.system !== system) return 'El prefijo tiene que coincidir con el sistema de la categoría.';
  if (n.extension) return 'Las extensiones (+) se crean desde su ID padre.';
  if (n.category !== category) return `El ID tiene que ser de la categoría ${category}.`;
  if (isReserved(n)) return 'De .00 a .09 son números de gestión de la categoría.';
  if (Number(n.id.split('.')[1]) % 10 === 0) return 'Los IDs que acaban en 0 son cabeceras.';
  const used = findId(index, n.id, system);
  if (used) return `Ya lo usa ${used.label}.`;
  return null;
}

/** Por qué el número de cabecera tecleado no se puede usar, o `null` si vale (copia
 *  `CreateHeaderModal.validate`). */
export function validateNewHeader(index: JdIndex, category: string, raw: string, system = index.system ?? ''): string | null {
  const n = parseJdNumber(raw);
  if (!n || n.kind !== 'id' || n.extension) return 'Escribe un número de cabecera como 14.20.';
  if (n.system && n.system !== system) return 'El prefijo tiene que coincidir con el sistema de la categoría.';
  if (n.category !== category) return `La cabecera tiene que ser de la categoría ${category}.`;
  const last = Number(n.id.split('.')[1]);
  if (last === 0 || last % 10 !== 0) return 'Una cabecera acaba en 0 (X0), de .10 a .90.';
  const used = findId(index, n.id, system);
  if (used) return `Ya lo usa ${used.label}.`;
  return null;
}

/** Un título vacío es el único motivo de rechazo del número: el número del hijo `+` es
 *  fijo (`${parent.id}+`, compartido por todos sus hermanos, distinguidos por título;
 *  copia `CreateChildModal.validate`). */
export function validateNewChildTitle(
  index: JdIndex,
  parent: IdEntry,
  title: string
): string | null {
  const titleError = requireTitle(title);
  if (titleError) return titleError;
  const trimmed = titleForCompare(jdexNoteName('', title).trim());
  const taken = index.ids.some((e) => e.id === `${parent.id}+` && sameSystem(e, parent) && titleForCompare(e.title) === trimmed);
  if (taken) return 'Ya hay un hijo con ese título.';
  return null;
}

/** Título vacío, único motivo de rechazo para categoría, área y cabecera (copia
 *  `StructureModal.currentError`, la parte que no es el número). */
export function requireTitle(title: string): string | null {
  if (title.includes('/')) return 'El título no puede contener /.';
  return title.trim() === '' ? 'Dale un título.' : null;
}
