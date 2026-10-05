/** Durable journal of successful Hebra writes. Undo rewrites use the host revision guard. */
import type { PluginNote, PluginNoteRevision, PluginVault } from 'hebra-plugin-api';
import { JOURNAL_MAX, pushOperation, type Operation, type OperationKind } from './engine';
import { updateJdexStoredSettings, type JdexSettingsStorage } from './settings';

export type JdexJournalEffect =
  | { kind: 'note-rewrite'; id: string; before: string; after: string; revision?: PluginNoteRevision }
  | { kind: 'note-create'; id: string; body: string; folderId: string; revision?: PluginNoteRevision }
  | { kind: 'note-move'; id: string; from: string; to: string; body: string | null; revision?: PluginNoteRevision }
  | { kind: 'note-trash'; id: string; trashedAt: number; revision: PluginNoteRevision }
  | { kind: 'folder-create'; id: string; name: string; parentId: string | null }
  | { kind: 'folder-change'; id: string; beforeName: string; beforeParentId: string | null; afterName: string; afterParentId: string | null };

export interface JdexJournal {
  entries(): readonly Operation<JdexJournalEffect>[];
  /** Use this vault for every write in the operation, including steps after an earlier write. */
  run<T>(kind: OperationKind, label: string, action: (vault: PluginVault) => Promise<T>): Promise<T>;
  /** Restores bodies only when they still equal the written body, with CAS and no stale retry. */
  undoLast(): Promise<{ undone: number; warnings: string[] }>;
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

type CommittedRewrite = { id: string; body: string; revision: PluginNoteRevision };
type BatchWithCommits = Awaited<ReturnType<PluginVault['notesRewriteBatch']>> & { committed?: CommittedRewrite[] };
type UndoResult = { warning: string | null; restored?: PluginNote };

function sameRevision(a: PluginNoteRevision, b: PluginNoteRevision): boolean {
  return a.localSeq === b.localSeq && a.bodySha256 === b.bodySha256;
}

/** Loads per-library history and serializes operations so later failures retain earlier writes. */
export async function createJdexJournal(vault: JdexJournalVault, storage: JdexSettingsStorage): Promise<JdexJournal> {
  const raw = await storage.load<{ jdexJournal?: Operation<JdexJournalEffect>[] } | null>();
  let entries = Array.isArray(raw?.jdexJournal) ? raw.jdexJournal.filter((entry) => entry && Array.isArray(entry.effects)).slice(-JOURNAL_MAX) : [];
  let tail: Promise<unknown> = Promise.resolve();
  const persist = () => updateJdexStoredSettings(storage, { jdexJournal: entries });
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.catch(() => undefined).then(action);
    tail = next;
    return next;
  };
  return {
    entries: () => entries,
    run: (kind, label, action) => serial(async () => {
      const operation: Operation<JdexJournalEffect> = { kind, label, at: new Date().toISOString(), effects: [] };
      const appendMany = async (effects: JdexJournalEffect[]): Promise<void> => {
        if (effects.length === 0) return;
        const first = operation.effects.length === 0;
        operation.effects.push(...effects);
        if (first) entries = pushOperation(entries, operation);
        await persist();
      };
      const append = (effect: JdexJournalEffect) => appendMany([effect]);
      const overrides: Partial<JdexJournalVault> = {
        noteCreate: async (input) => {
          const note = await vault.noteCreate(input);
          await append({ kind: 'note-create', id: note.id, body: note.body ?? input.body, folderId: note.folderId, revision: { ...note.revision } });
          return note;
        },
        notesRewriteBatch: async (requests, options) => {
          const before = new Map(await Promise.all(requests.map(async (entry) => [entry.id, await vault.noteRead(entry.id)] as const)));
          const result: BatchWithCommits = await vault.notesRewriteBatch(requests, options);
          const committed = new Map(result.committed?.map((entry) => [entry.id, entry]));
          const effects: JdexJournalEffect[] = [];
          for (const id of result.written) {
            const prior = before.get(id);
            const request = requests.find((entry) => entry.id === id);
            const written = committed.get(id);
            if (prior?.body !== null && prior && request && sameRevision(prior.revision, request.expected) && prior.body !== (written?.body ?? request.body)) {
              // The host reports the exact committed body/revision. An older host still
              // records the write, but undo refuses the effect without its revision.
              effects.push({ kind: 'note-rewrite', id, before: prior.body, after: written?.body ?? request.body,
                revision: written ? { ...written.revision } : undefined });
            }
          }
          await appendMany(effects);
          return result;
        },
        noteSave: async (input) => {
          const prior = await vault.noteRead(input.id);
          const result = await vault.noteSave(input);
          if (result.outcome === 'saved' && prior?.body !== null && prior && sameRevision(prior.revision, input.expected) && prior.body !== input.body) {
            await append({ kind: 'note-rewrite', id: input.id, before: prior.body, after: input.body, revision: { ...result.revision } });
          }
          if (result.outcome === 'redirected' && prior) await append({ kind: 'note-create', id: result.id, body: input.body, folderId: prior.folderId, revision: { ...result.revision } });
          return result;
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
        folderMove: async (id, parentId) => {
          const before = (await vault.foldersList()).find((folder) => folder.id === id);
          const folder = await vault.folderMove(id, parentId);
          if (before && before.parentId !== folder.parentId) await append({ kind: 'folder-change', id, beforeName: before.name, beforeParentId: before.parentId, afterName: folder.name, afterParentId: folder.parentId });
          return folder;
        }
      };
      const tracked = new Proxy(vault, { get: (target, key) => {
        const override = overrides[key as keyof PluginVault];
        if (override) return override;
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) as unknown : value;
      } });
      return action(tracked);
    }),
    undoLast: () => serial(async () => {
      const operation = entries[entries.length - 1];
      if (!operation) return { undone: 0, warnings: ['No hay operaciones que deshacer.'] };
      let undone = 0;
      const warnings: string[] = [];
      for (let i = operation.effects.length - 1; i >= 0; i -= 1) {
        const effect = operation.effects[i];
        const { warning, restored } = await undoEffect(vault, effect);
        if (warning) { warnings.push(warning); break; }
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
        undone += 1;
        if (operation.effects.length === 0) entries = entries.slice(0, -1);
        await persist();
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
