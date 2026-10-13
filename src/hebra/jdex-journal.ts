/**
 * Durable journal of successful Hebra writes. Undo rewrites use the host revision guard.
 *
 * Política de guardado (tarea 11e032cd):
 * - Una reescritura (`notesRewriteBatch`, `noteSave`) se apunta ANTES de escribir, como
 *   intención (`pending`); si ese apunte no se puede guardar, no se escribe nada.
 * - El resto de escrituras (crear, mover, papelera, carpetas) se apunta justo después.
 * - Cada guardado se reintenta una vez. Si vuelve a fallar, la operación se DETIENE con un
 *   error (no se declara éxito), el diario queda en memoria marcado como no guardado
 *   (`status().unsaved`) y el siguiente guardado, de cualquier operación, lo escribe entero.
 * - Antes de cada inversa el efecto se marca `undoing` y se guarda; si la app se cierra entre
 *   la inversa y la retirada del efecto, al volver se reconoce la inversa ya aplicada y el
 *   efecto se retira, en vez de quedar bloqueado por el CAS.
 * - Una intención que no llegó a confirmarse queda en el diario y deshacer la rechaza con
 *   aviso: la salida es revisar a mano y descartar la entrada.
 * No es una transacción entre la biblioteca y el diario: reduce la ventana, no la cierra. Una
 * nota o carpeta creada justo antes de un cierre puede quedar fuera del diario.
 */
import type { PluginDeviceStorage, PluginNote, PluginNoteRevision, PluginVault } from 'hebra-plugin-api/v2';
import { appendOperation, JOURNAL_MAX, JOURNAL_REMOVED_MAX, JOURNAL_VERSION, journalOperationId, mergeJournals, newJournalId, withJournalIds, type Operation, type OperationKind } from './engine';
import { updateJdexStoredSettings, type JdexSettingsStorage } from './settings';

/** `pending`: apuntado antes de escribir y sin confirmar. `undoing`: su inversa empezó. */
type JournalFlags = { pending?: boolean; undoing?: boolean };

export type JdexJournalEffect = (
  | { kind: 'note-rewrite'; id: string; before: string; after: string; revision?: PluginNoteRevision }
  | { kind: 'note-create'; id: string; body: string; folderId: string; revision?: PluginNoteRevision }
  | { kind: 'note-move'; id: string; from: string; to: string; body: string | null; revision?: PluginNoteRevision }
  | { kind: 'note-trash'; id: string; trashedAt: number; revision: PluginNoteRevision }
  | { kind: 'folder-create'; id: string; name: string; parentId: string | null }
  | { kind: 'folder-change'; id: string; beforeName: string; beforeParentId: string | null; afterName: string; afterParentId: string | null }
) & JournalFlags;

export interface JdexJournalRunOptions {
  /** Escritura automática (cabeceras vivas, mantenimiento): no toca lo que un deshacer acaba de restaurar. */
  automatic?: boolean;
}

export interface JdexJournal {
  entries(): readonly Operation<JdexJournalEffect>[];
  /**
   * Use this vault for every write in the operation, including steps after an earlier write.
   * Every write made through it during `action` belongs to ONE entry, however many calls or
   * batches it takes.
   */
  run<T>(kind: OperationKind, label: string, action: (vault: PluginVault) => Promise<T>, options?: JdexJournalRunOptions): Promise<T>;
  /**
   * Restores bodies only when they still equal the written body, with CAS and no stale retry.
   * With `expectedId`, undoes only that operation, and only if it is still the last one when
   * its turn in the queue comes; otherwise nothing is undone.
   */
  undoLast(expectedId?: string): Promise<{ undone: number; warnings: string[] }>;
  /** Removes the last entry (it must be `expectedId`) without touching the library. */
  discardLast(expectedId: string): Promise<boolean>;
  /** Joins a journal stored elsewhere (another tab or device) by identity. */
  absorb(stored: unknown): void;
  /** Library changes seen by the host; after an undo settles they lift its protection. */
  observe(ids: readonly string[]): void;
  status(): { unsaved: boolean; readOnly: boolean };
  /** Device of this journal; operations of another device are not undone. */
  readonly device: string | undefined;
}

/** Optional host extension: only removes an unchanged empty folder, never its contents. */
export type JdexJournalVault = PluginVault & {
  folderTrashEmpty?(id: string, expected: { name: string; parentId: string | null }): Promise<boolean>;
  noteRestore?(id: string, expected: { trashedAt: number; revision: PluginNoteRevision }): Promise<boolean>;
  noteRestoreIfUnchanged?(id: string, expected: { trashedAt: number; revision: PluginNoteRevision }): Promise<PluginNote | null>;
  noteTrashIfUnchanged?(id: string, expected: { revision: PluginNoteRevision; folderId: string }): Promise<PluginNote | null>;
  noteMoveIfUnchanged?(id: string, folderId: string, expected: { revision: PluginNoteRevision; folderId: string }): Promise<PluginNote | null>;
  folderRenameIfUnchanged?(id: string, name: string, expected: { name: string; parentId: string | null }): Promise<Awaited<ReturnType<PluginVault['folderRename']>> | null>;
  folderMoveIfUnchanged?(id: string, parentId: string | null, expected: { name: string; parentId: string | null }): Promise<Awaited<ReturnType<PluginVault['folderMove']>> | null>;
};

export interface JdexJournalOptions {
  /** Identity of this device (`jdexDeviceId`). Without it, entries carry no device. */
  device?: string;
  /** Clock for the undo settle window (tests). */
  now?: () => number;
  /** How long after an undo its own change notices may still arrive. */
  settleMs?: number;
  /** Operations dropped to keep the stored journal within `JDEX_JOURNAL_SETTINGS_BUDGET`. */
  onTrimmed?: (message: string) => void;
}

/**
 * Hebra does not publish a settings blob longer than 256 KiB (`MAX_SYNCED_SETTINGS_CHARS`,
 * `plugin-sync-controller.ts`): it only logs, and the next reconciliation overwrites the
 * local value with the remote one, journal and settings included. The journal lives in
 * that blob, so the whole blob is kept under this budget (with room for the settings).
 */
export const JDEX_JOURNAL_SETTINGS_BUDGET = 240 * 1024;

/** Drops the oldest operations (the newest too, if it alone does not fit) until the
 *  stored value fits `budget`. Dropped operations are remembered as removed. */
function fitJournal(current: Record<string, unknown>, entries: Operation<JdexJournalEffect>[], removed: string[], budget: number) {
  const empty = JSON.stringify({ ...current, jdexJournal: [], jdexJournalRemoved: removed, jdexJournalVersion: JOURNAL_VERSION }).length;
  const sizes = entries.map((entry) => JSON.stringify(entry).length);
  let total = empty + sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, entries.length - 1);
  let start = 0;
  const ids = [...removed];
  while (start < entries.length && total > budget) {
    total -= sizes[start] + (entries.length - start > 1 ? 1 : 0);
    const id = journalOperationId(entries[start]);
    ids.push(id);
    total += JSON.stringify(id).length + 1;
    start += 1;
  }
  return { entries: entries.slice(start), removed: ids.slice(-JOURNAL_REMOVED_MAX), dropped: entries.slice(0, start) };
}

function trimmedMessage(dropped: readonly Operation<JdexJournalEffect>[]): string {
  const labels = dropped.map((operation) => `«${operation.label}»`).join(', ');
  return dropped.length === 1
    ? `${labels} ya no se puede deshacer: el diario de deshacer superaba el tamaño que Hebra sincroniza entre dispositivos.`
    : `${labels} ya no se pueden deshacer: el diario de deshacer superaba el tamaño que Hebra sincroniza entre dispositivos.`;
}

/** Raised when the journal could not be saved after a retry; the operation stops. */
export class JdexJournalSaveError extends Error {
  constructor(cause: unknown) {
    super(`El diario de deshacer no se pudo guardar (${cause instanceof Error ? cause.message : String(cause)}); la operación se detiene. Lo hecho hasta aquí sigue en el diario en memoria y se guardará con el próximo cambio.`);
    this.name = 'JdexJournalSaveError';
  }
}

const DEVICE_KEY = 'jdex-manager-device';

/** Stable id of this device and library, in the host's device storage (never synced). */
export function jdexDeviceId(device: Pick<PluginDeviceStorage, 'get' | 'set'>): string {
  const existing = device.get<string>(DEVICE_KEY);
  if (typeof existing === 'string' && existing !== '') return existing;
  const id = newJournalId();
  device.set(DEVICE_KEY, id);
  return id;
}

type CommittedRewrite = { id: string; body: string; revision: PluginNoteRevision };
type BatchWithCommits = Awaited<ReturnType<PluginVault['notesRewriteBatch']>> & { committed?: CommittedRewrite[] };
type UndoResult = { warning: string | null; restored?: PluginNote };
type Stored = { jdexJournal?: unknown; jdexJournalRemoved?: unknown; jdexJournalVersion?: unknown };

const KNOWN = new Set(['note-rewrite', 'note-create', 'note-move', 'note-trash', 'folder-create', 'folder-change']);

function sameRevision(a: PluginNoteRevision, b: PluginNoteRevision): boolean {
  return a.localSeq === b.localSeq && a.bodySha256 === b.bodySha256;
}

function isOperation(entry: unknown): entry is Operation<JdexJournalEffect> {
  return typeof entry === 'object' && entry !== null && Array.isArray((entry as Operation).effects);
}

function storedState(raw: unknown): { entries: Operation<JdexJournalEffect>[]; removed: string[]; version: number } {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Stored;
  const entries = Array.isArray(stored.jdexJournal) ? stored.jdexJournal.filter(isOperation) : [];
  const removed = Array.isArray(stored.jdexJournalRemoved) ? stored.jdexJournalRemoved.filter((id): id is string => typeof id === 'string') : [];
  const version = typeof stored.jdexJournalVersion === 'number' ? stored.jdexJournalVersion : 1;
  return { entries, removed, version };
}

/** Loads per-library history and serializes operations so later failures retain earlier writes. */
export async function createJdexJournal(vault: JdexJournalVault, storage: JdexSettingsStorage, options: JdexJournalOptions = {}): Promise<JdexJournal> {
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? 1500;
  const initial = storedState(await storage.load<Stored | null>());
  // A journal from a newer version is kept untouched: no recording, no undo, no save.
  const readOnly = initial.version > JOURNAL_VERSION;
  let entries = readOnly ? [] : withJournalIds(initial.entries.filter((entry) => entry.effects.length > 0)).slice(-JOURNAL_MAX);
  let removed = readOnly ? [] : initial.removed;
  let unsaved = false;
  let tail: Promise<unknown> = Promise.resolve();
  const protectedIds = new Set<string>();
  let undoRunning = false;
  let undoSettledAt = 0;

  // Effects interrupted by a close: a rewrite intent that never ran is dropped, an inverse
  // already applied is retired, and the rest keeps its flag so undo can explain it.
  // Only this device's operations (or ones without a device): another device may be in
  // the middle of writing or undoing them. A changed operation gets a higher `rev` so a
  // merge keeps it, and one left empty is remembered as removed.
  let recovered = false;
  for (const operation of entries) {
    if (operation.device && options.device && operation.device !== options.device) continue;
    let changed = false;
    for (let i = operation.effects.length - 1; i >= 0; i -= 1) {
      const effect = operation.effects[i];
      if (effect.undoing && await inverseApplied(vault, effect)) { operation.effects.splice(i, 1); changed = true; continue; }
      if (effect.undoing) { delete effect.undoing; changed = true; }
      if (effect.pending && effect.kind === 'note-rewrite' && (await vault.noteRead(effect.id))?.body === effect.before) { operation.effects.splice(i, 1); changed = true; }
    }
    if (!changed) continue;
    recovered = true;
    operation.rev = (operation.rev ?? 0) + 1;
    if (operation.effects.length === 0) removed = [...removed, journalOperationId(operation)].slice(-JOURNAL_REMOVED_MAX);
  }
  if (recovered) entries = entries.filter((entry) => entry.effects.length > 0);

  const saveOnce = async () => {
    let dropped: Operation<JdexJournalEffect>[] = [];
    await updateJdexStoredSettings(storage, (current) => {
      const merged = mergeJournals({ entries, removed }, storedState(current), JOURNAL_MAX);
      const fitted = fitJournal(current, merged.entries, merged.removed.slice(-JOURNAL_REMOVED_MAX), JDEX_JOURNAL_SETTINGS_BUDGET);
      entries = fitted.entries;
      removed = fitted.removed;
      dropped = fitted.dropped;
      return { jdexJournal: entries, jdexJournalRemoved: removed, jdexJournalVersion: JOURNAL_VERSION };
    });
    if (dropped.length > 0) options.onTrimmed?.(trimmedMessage(dropped));
  };
  const persist = async (): Promise<void> => {
    if (readOnly) return;
    try {
      await saveOnce();
    } catch {
      try {
        await saveOnce();
      } catch (error) {
        unsaved = true;
        throw new JdexJournalSaveError(error);
      }
    }
    unsaved = false;
  };
  if (recovered) await persist().catch(() => undefined);

  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.catch(() => undefined).then(action);
    tail = next;
    return next;
  };
  const settling = () => undoRunning || now() < undoSettledAt;

  return {
    device: options.device,
    entries: () => entries,
    status: () => ({ unsaved, readOnly }),
    observe: (ids) => {
      if (settling()) return;
      for (const id of ids) protectedIds.delete(id);
    },
    absorb: (stored) => {
      if (readOnly) return;
      const state = storedState(stored);
      if (state.version > JOURNAL_VERSION) return;
      const merged = mergeJournals({ entries, removed }, state, JOURNAL_MAX);
      entries = merged.entries;
      removed = merged.removed;
    },
    run: (kind, label, action, runOptions = {}) => serial(async () => {
      const operation: Operation<JdexJournalEffect> = { id: newJournalId(), device: options.device, kind, label, at: new Date().toISOString(), effects: [], rev: 0 };
      let listed = false;
      const automatic = runOptions.automatic === true;
      const touch = async () => {
        operation.rev = (operation.rev ?? 0) + 1;
        if (operation.effects.length > 0 && !listed) {
          listed = true;
          ({ entries, removed } = appendOperation({ entries, removed }, operation, JOURNAL_MAX));
          // A new operation of the user ends the protection of what the last undo restored.
          if (!automatic) protectedIds.clear();
        } else if (operation.effects.length === 0 && listed) {
          listed = false;
          entries = entries.filter((entry) => entry !== operation);
          // The write-ahead entry was stored already. Tombstone its identity so a
          // merge cannot revive a stale write; a later step in this run gets a new id.
          removed = [...removed, journalOperationId(operation)].slice(-JOURNAL_REMOVED_MAX);
          operation.id = newJournalId();
        }
        await persist();
      };
      const appendMany = async (effects: JdexJournalEffect[]): Promise<void> => {
        if (effects.length === 0 || readOnly) return;
        operation.effects.push(...effects);
        await touch();
      };
      const append = (effect: JdexJournalEffect) => appendMany([effect]);
      /** Settles rewrite intents after the host call: confirmed ones keep the committed body and revision. */
      const settleIntents = async (intents: Extract<JdexJournalEffect, { kind: 'note-rewrite' }>[], result: BatchWithCommits | null) => {
        if (intents.length === 0) return;
        const committed = new Map(result?.committed?.map((entry) => [entry.id, entry]));
        for (const intent of intents) {
          const written = result?.written.includes(intent.id) ? committed.get(intent.id) : undefined;
          const happened = result ? result.written.includes(intent.id) : (await vault.noteRead(intent.id))?.body !== intent.before;
          if (!happened || (written && written.body === intent.before)) {
            const at = operation.effects.indexOf(intent);
            if (at !== -1) operation.effects.splice(at, 1);
            continue;
          }
          delete intent.pending;
          // The host reports the exact committed body/revision. An older host still
          // records the write, but undo refuses the effect without its revision.
          if (written) { intent.after = written.body; intent.revision = { ...written.revision }; }
          else if (result) intent.revision = undefined;
          else intent.pending = true;
        }
        await touch();
      };
      const rewriteWithIntents = async (requests: Parameters<PluginVault['notesRewriteBatch']>[0], batchOptions?: Parameters<PluginVault['notesRewriteBatch']>[1]): Promise<BatchWithCommits> => {
        const before = new Map(await Promise.all(requests.map(async (entry) => [entry.id, await vault.noteRead(entry.id)] as const)));
        const intents: Extract<JdexJournalEffect, { kind: 'note-rewrite' }>[] = [];
        for (const request of requests) {
          const prior = before.get(request.id);
          if (prior && prior.body !== null && sameRevision(prior.revision, request.expected) && prior.body !== request.body) {
            intents.push({ kind: 'note-rewrite', id: request.id, before: prior.body, after: request.body, pending: true });
          }
        }
        // Write-ahead: if the intent cannot be saved, nothing is written.
        await appendMany(intents);
        let result: BatchWithCommits;
        try {
          result = await vault.notesRewriteBatch(requests.map((request) => ({ ...request, strictRevision: true })), batchOptions);
        } catch (error) {
          await settleIntents(intents, null).catch(() => undefined);
          throw error;
        }
        await settleIntents(intents, result);
        return result;
      };
      const overrides: Partial<JdexJournalVault> = {
        noteCreate: async (input) => {
          const note = await vault.noteCreate(input);
          await append({ kind: 'note-create', id: note.id, body: note.body ?? input.body, folderId: note.folderId, revision: { ...note.revision } });
          return note;
        },
        notesRewriteBatch: async (requests, batchOptions) => {
          const allowed = automatic ? requests.filter((request) => !protectedIds.has(request.id)) : requests;
          // What an undo just restored is held back, and said so (`held`): neither written
          // nor stale, the caller counts it as skipped instead of losing it.
          const held = requests.filter((request) => !allowed.includes(request)).map((request) => request.id);
          if (allowed.length === 0) return { written: [], stale: [], committed: [], held };
          return { ...(await rewriteWithIntents(allowed, batchOptions)), held };
        },
        noteSave: async (input) => {
          if (automatic && protectedIds.has(input.id)) throw new Error('Esta nota acaba de restaurarse al deshacer; no se reescribe automáticamente.');
          const prior = await vault.noteRead(input.id);
          if (!prior || prior.body === null || !sameRevision(prior.revision, input.expected)) throw new Error('La nota cambió antes del guardado; se conserva sin modificar.');
          // Journaled saves require a strict preimage and the exact committed body.
          // A stale save stops the operation instead of creating an untracked conflict copy.
          const result = await rewriteWithIntents([{ ...input }]);
          const committed = result.committed?.find((entry) => entry.id === input.id);
          if (!result.written.includes(input.id)) throw new Error('La nota cambió durante el guardado; se conserva sin modificar.');
          if (!committed) throw new Error('Hebra no devolvió la revisión exacta del guardado; se conserva el diario.');
          return { outcome: 'saved', id: input.id, revision: { ...committed.revision } };
        },
        noteMove: async (id, folderId) => {
          const prior = await vault.noteRead(id);
          const result = await vault.noteMove(id, folderId);
          if (prior && prior.folderId !== result.folderId) await append({ kind: 'note-move', id, from: prior.folderId, to: result.folderId, body: result.body, revision: { ...result.revision } });
          return result;
        },
        noteMoveIfUnchanged: async (id, folderId, expected) => {
          if (!vault.noteMoveIfUnchanged) throw new Error('Hebra no ofrece movimiento atómico de notas.');
          const prior = await vault.noteRead(id);
          const result = await vault.noteMoveIfUnchanged(id, folderId, expected);
          if (result && prior && prior.folderId !== result.folderId && sameRevision(prior.revision, expected.revision) && prior.folderId === expected.folderId) {
            await append({ kind: 'note-move', id, from: prior.folderId, to: result.folderId, body: result.body, revision: { ...result.revision } });
          }
          return result;
        },
        noteTrash: async (id) => {
          const prior = await vault.noteRead(id);
          const result = await vault.noteTrash(id);
          if (prior?.trashedAt === null && result.trashedAt !== null) await append({ kind: 'note-trash', id, trashedAt: result.trashedAt, revision: { ...result.revision } });
          return result;
        },
        noteTrashIfUnchanged: async (id, expected) => {
          if (!vault.noteTrashIfUnchanged) throw new Error('Hebra no ofrece papelera atómica de notas.');
          const result = await vault.noteTrashIfUnchanged(id, expected);
          if (result?.trashedAt !== null && result?.trashedAt !== undefined) await append({ kind: 'note-trash', id, trashedAt: result.trashedAt, revision: { ...result.revision } });
          return result;
        },
        folderCreate: async (parentId, name) => {
          const folder = await vault.folderCreate(parentId, name);
          await append({ kind: 'folder-create', id: folder.id, name: folder.name, parentId: folder.parentId });
          return folder;
        },
        folderRename: async (id, name) => {
          const before = (await vault.foldersList()).find((folder) => folder.id === id);
          const folder = await vault.folderRename(id, name);
          if (before && before.name !== folder.name) await append({ kind: 'folder-change', id, beforeName: before.name, beforeParentId: before.parentId, afterName: folder.name, afterParentId: folder.parentId });
          return folder;
        },
        folderRenameIfUnchanged: async (id, name, expected) => {
          if (!vault.folderRenameIfUnchanged) throw new Error('Hebra no ofrece renombrado atómico de carpetas.');
          const folder = await vault.folderRenameIfUnchanged(id, name, expected);
          if (folder && expected.name !== folder.name) await append({ kind: 'folder-change', id, beforeName: expected.name, beforeParentId: expected.parentId, afterName: folder.name, afterParentId: folder.parentId });
          return folder;
        },
        folderMoveIfUnchanged: async (id, parentId, expected) => {
          if (!vault.folderMoveIfUnchanged) throw new Error('Hebra no ofrece movimiento atómico de carpetas.');
          const folder = await vault.folderMoveIfUnchanged(id, parentId, expected);
          if (folder && expected.parentId !== folder.parentId) await append({ kind: 'folder-change', id, beforeName: expected.name, beforeParentId: expected.parentId, afterName: folder.name, afterParentId: folder.parentId });
          return folder;
        },
        folderMove: async (id, parentId) => {
          const before = (await vault.foldersList()).find((folder) => folder.id === id);
          const folder = await vault.folderMove(id, parentId);
          if (before && before.parentId !== folder.parentId) await append({ kind: 'folder-change', id, beforeName: before.name, beforeParentId: before.parentId, afterName: folder.name, afterParentId: folder.parentId });
          return folder;
        }
      };
      // The frame API is frozen: proxying it as the target would forbid overrides of
      // its non-configurable methods. The empty target keeps the public surface intact.
      const tracked = new Proxy({} as JdexJournalVault, { get: (_target, key) => {
        const override = overrides[key as keyof PluginVault];
        if (override) return override;
        const value: unknown = Reflect.get(vault, key);
        return typeof value === 'function' ? value.bind(vault) as unknown : value;
      } });
      return action(tracked);
    }),
    discardLast: (expectedId) => serial(async () => {
      if (readOnly) return false;
      const operation = entries[entries.length - 1];
      if (!operation || journalOperationId(operation) !== expectedId) return false;
      entries = entries.slice(0, -1);
      removed = [...removed, expectedId].slice(-JOURNAL_REMOVED_MAX);
      await persist();
      return true;
    }),
    undoLast: (expectedId) => serial(async () => {
      if (readOnly) return { undone: 0, warnings: ['El diario lo escribió una versión más nueva de JDex Manager; actualiza el plugin para deshacer.'] };
      const operation = entries[entries.length - 1];
      if (!operation) return { undone: 0, warnings: ['No hay operaciones que deshacer.'] };
      const id = journalOperationId(operation);
      if (expectedId !== undefined && id !== expectedId) return { undone: 0, warnings: ['El diario cambió desde que se abrió; no se deshizo nada. Vuelve a abrirlo para ver la última operación.'] };
      if (operation.device && options.device && operation.device !== options.device) {
        return { undone: 0, warnings: [`«${operation.label}» se hizo en otro dispositivo: deshazla allí o descarta la entrada.`] };
      }
      let undone = 0;
      const warnings: string[] = [];
      undoRunning = true;
      for (const effect of operation.effects) protectedIds.add(effect.id);
      try {
        for (let i = operation.effects.length - 1; i >= 0; i -= 1) {
          const effect = operation.effects[i];
          if (!KNOWN.has(effect.kind)) {
            warnings.push(`Un paso de tipo «${String(effect.kind)}» viene de otra versión y esta no sabe deshacerlo; la entrada se conserva.`);
            break;
          }
          if (effect.pending) {
            warnings.push(`${effect.id}: esta escritura se interrumpió antes de confirmarse; revísala a mano y descarta la entrada.`);
            break;
          }
          let restored: PluginNote | undefined;
          if (effect.undoing && await inverseApplied(vault, effect)) {
            // A close interrupted this inverse after it ran: retire it without replaying.
          } else {
            // Write-ahead marker: a close after the inverse is recognised on the next load.
            effect.undoing = true;
            operation.rev = (operation.rev ?? 0) + 1;
            await persist();
            const result = await undoEffect(vault, effect);
            if (result.warning) {
              delete effect.undoing;
              await persist().catch(() => undefined);
              warnings.push(result.warning);
              break;
            }
            restored = result.restored;
          }
          if (restored) {
            // Rebase only the nearest earlier write to this note, including earlier
            // operations. The revision comes from our own atomic inverse, never a read.
            const earlier = [operation.effects.slice(0, i), ...entries.slice(0, -1).reverse().map((entry) => [...entry.effects])];
            for (const effects of earlier) {
              const prior = [...effects].reverse().find((candidate) => candidate.id === effect.id);
              if (!prior) continue;
              if (matchesWrittenNote(restored, prior)) prior.revision = { ...restored.revision };
              break;
            }
          }
          operation.effects.splice(i, 1);
          operation.rev = (operation.rev ?? 0) + 1;
          undone += 1;
          if (operation.effects.length === 0) {
            entries = entries.filter((entry) => entry !== operation);
            removed = [...removed, id].slice(-JOURNAL_REMOVED_MAX);
          }
          await persist();
        }
      } finally {
        undoRunning = false;
        undoSettledAt = now() + settleMs;
      }
      return { undone, warnings };
    })
  };
}

/** After undoing one step, only its immediately preceding step on the same note can
 * adopt the new revision, and only when its written body and location are present. */
function matchesWrittenNote(note: PluginNote, effect: JdexJournalEffect): effect is Extract<JdexJournalEffect, { kind: 'note-rewrite' | 'note-create' | 'note-move' }> {
  if (note.body === null || note.trashedAt !== null) return false;
  if (effect.kind === 'note-rewrite') return note.body === effect.after;
  if (effect.kind === 'note-create') return note.body === effect.body && note.folderId === effect.folderId;
  if (effect.kind === 'note-move') return note.body === effect.body && note.folderId === effect.to;
  return false;
}

/** True when the library already shows the inverse of `effect` (a close interrupted the undo after it ran). */
async function inverseApplied(vault: JdexJournalVault, effect: JdexJournalEffect): Promise<boolean> {
  if (effect.kind === 'folder-create' || effect.kind === 'folder-change') {
    const folder = (await vault.foldersList()).find((entry) => entry.id === effect.id);
    if (effect.kind === 'folder-create') return !folder;
    return !!folder && folder.name === effect.beforeName && folder.parentId === effect.beforeParentId;
  }
  if (!KNOWN.has(effect.kind)) return false;
  const note = await vault.noteRead(effect.id);
  if (effect.kind === 'note-rewrite') return !!note && note.body === effect.before;
  if (effect.kind === 'note-create') return !note || note.trashedAt !== null;
  if (effect.kind === 'note-move') return !!note && note.folderId === effect.from;
  return !!note && note.trashedAt === null;
}

/** Checks live state before each inverse; body restoration additionally uses the host CAS. */
async function undoEffect(vault: JdexJournalVault, effect: JdexJournalEffect): Promise<UndoResult> {
  const changed = `${effect.id}: no se deshizo porque desapareció, está bloqueado o cambió después de la operación.`;
  if (effect.kind === 'note-rewrite' || effect.kind === 'note-create' || effect.kind === 'note-move') {
    const note = await vault.noteRead(effect.id);
    if (!effect.revision) return { warning: `${effect.id}: Hebra no devolvió la revisión exacta; se conserva el diario.` };
    if (!note || note.body === null || note.trashedAt !== null || !sameRevision(note.revision, effect.revision)) return { warning: changed };
    if (effect.kind === 'note-rewrite') {
      if (note.body !== effect.after) return { warning: changed };
      const result: BatchWithCommits = await vault.notesRewriteBatch([{ id: note.id, body: effect.before, expected: effect.revision, strictRevision: true }], { cause: 'Antes de deshacer una operación JDex' });
      if (!result.written.includes(note.id)) return { warning: `${effect.id}: no se deshizo porque cambió durante la escritura.` };
      const committed = result.committed?.find((entry) => entry.id === note.id);
      return { warning: null, restored: committed ? { ...note, body: committed.body, revision: committed.revision } : undefined };
    }
    if (effect.kind === 'note-create') {
      if (note.body !== effect.body || note.folderId !== effect.folderId) return { warning: changed };
      if (!vault.noteTrashIfUnchanged) return { warning: 'Hebra no ofrece papelera atómica de notas. Se conserva el diario.' };
      return { warning: await vault.noteTrashIfUnchanged(note.id, { revision: effect.revision, folderId: effect.folderId }) ? null : changed };
    }
    if (note.folderId !== effect.to || note.body !== effect.body) return { warning: changed };
    if (!vault.noteMoveIfUnchanged) return { warning: 'Hebra no ofrece movimiento atómico de notas. Se conserva el diario.' };
    const restored = await vault.noteMoveIfUnchanged(note.id, effect.from, { revision: effect.revision, folderId: effect.to });
    return { warning: restored ? null : changed, restored: restored ?? undefined };
  }
  if (effect.kind === 'note-trash') {
    if (!vault.noteRestoreIfUnchanged) return { warning: 'Hebra no ofrece restauración atómica con revisión. Se conserva el diario.' };
    const restored = await vault.noteRestoreIfUnchanged(effect.id, { trashedAt: effect.trashedAt, revision: effect.revision });
    return { warning: restored ? null : changed, restored: restored ?? undefined };
  }
  const folder = (await vault.foldersList()).find((entry) => entry.id === effect.id);
  if (!folder) return { warning: changed };
  if (effect.kind === 'folder-change') {
    if (folder.name !== effect.afterName || folder.parentId !== effect.afterParentId) return { warning: changed };
    const expected = { name: effect.afterName, parentId: effect.afterParentId };
    if (effect.beforeName !== effect.afterName) {
      if (!vault.folderRenameIfUnchanged) return { warning: 'Hebra no ofrece renombrado atómico de carpetas. Se conserva el diario.' };
      return { warning: await vault.folderRenameIfUnchanged(folder.id, effect.beforeName, expected) ? null : changed };
    }
    if (!vault.folderMoveIfUnchanged) return { warning: 'Hebra no ofrece movimiento atómico de carpetas. Se conserva el diario.' };
    return { warning: await vault.folderMoveIfUnchanged(folder.id, effect.beforeParentId, expected) ? null : changed };
  }
  if (folder.name !== effect.name || folder.parentId !== effect.parentId) return { warning: changed };
  if (!vault.folderTrashEmpty) return { warning: 'Hebra no ofrece retirar una carpeta vacía desde la API del plugin. Se conserva el diario.' };
  return { warning: await vault.folderTrashEmpty(effect.id, { name: effect.name, parentId: effect.parentId }) ? null : `${effect.id}: la carpeta cambió o ya no está vacía; se conserva.` };
}
