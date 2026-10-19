/**
 * Pure validation for "create ID / header / `+` child": the rules the Hebra plugin's
 * Create dialogs apply, shared with any host of the engine (moved from
 * `src/hebra/jdex-create.ts`). Messages are Spanish, like the audit.
 */
import { findId, selectCreationSystem, selectSystem, sameSystem, type IdEntry, type JdIndex } from "./index";
import { isReserved, jdexNoteName, parseJdNumber } from "./parse";
import { titleForCompare } from "./title";

/**
 * What the Create ID / header / category dialogs offer: the configured creation system
 * (`prefix`, with the unprefixed scaffolding it may borrow, `selectCreationSystem`) plus
 * the areas and categories of every OTHER prefixed system in the library, each with its
 * own identity. Without this, a library whose categories are all `D01` or `D02` offers
 * nothing when no prefix is configured. D01, D02 and the default system never mix
 * (decision of 5 Oct 2026): every entry keeps its `system`, and the default system only
 * appears when it is the configured one (otherwise its scaffolding is already borrowed).
 * The result has no `system`, so number lookups must pass the entry's own system.
 */
export function jdexCreationIndex(index: JdIndex, prefix: string): JdIndex {
  const base = selectCreationSystem(index, prefix);
  const others = new Set<string>();
  for (const entry of [...index.areas, ...index.categories]) {
    const system = entry.system ?? '';
    if (system !== '' && system !== prefix) others.add(system);
  }
  const merged: JdIndex = { ...base, areas: [...base.areas], categories: [...base.categories], ids: [...base.ids], misplaced: [...base.misplaced],
    rawIdFolders: [...base.rawIdFolders], rawIdNotes: [...base.rawIdNotes], malformed: [...(base.malformed ?? [])] };
  delete merged.system;
  for (const system of [...others].sort()) {
    const own = selectSystem(index, system);
    merged.areas.push(...own.areas);
    merged.categories.push(...own.categories);
    merged.ids.push(...own.ids);
    merged.misplaced.push(...own.misplaced);
    merged.rawIdFolders.push(...own.rawIdFolders);
    merged.rawIdNotes.push(...own.rawIdNotes);
    merged.malformed!.push(...(own.malformed ?? []));
  }
  return merged;
}

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

/** A `+` child is never a parent: `21.22+` would produce `21.22++`, which the parser
 *  rejects (Obsidian excludes these parents too). Children of an ID are told apart by
 *  title, without renumbering. */
export function isJdexChildEntry(entry: Pick<IdEntry, 'id'>): boolean {
  return entry.id.endsWith('+');
}

export const JDEX_CHILD_OF_CHILD_MESSAGE = 'Un hijo (+) no puede tener hijos: créalo desde su ID padre.';

/** Un título vacío es el único motivo de rechazo del número: el número del hijo `+` es
 *  fijo (`${parent.id}+`, compartido por todos sus hermanos, distinguidos por título;
 *  copia `CreateChildModal.validate`). */
export function validateNewChildTitle(
  index: JdIndex,
  parent: IdEntry,
  title: string
): string | null {
  if (isJdexChildEntry(parent)) return JDEX_CHILD_OF_CHILD_MESSAGE;
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
