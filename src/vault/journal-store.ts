/**
 * The Obsidian undo journal and the `data.json` it shares with the settings.
 *
 * - Every operation has an identity (`id`), the device that made it and a revision; undo and
 *   discard act on the confirmed identity, never on "whatever is last now".
 * - Each effect is persisted as soon as it happens (`begin` returns a sink that saves on `push`).
 *   This narrows the window between a write and its journal entry; it is not a transaction.
 * - Saving re-reads `data.json` first: settings changed elsewhere and not changed here are kept,
 *   and the two journals are joined by identity (`mergeJournals`), not concatenated.
 * - A journal written by a newer version is kept as it is and never recorded into or undone.
 * No Node or Electron APIs: only the plugin's `loadData`/`saveData` and Obsidian's local storage.
 */
import type { App } from "obsidian";
import {
  describeUndo,
  appendOperation,
  durableEffect,
  type Effect,
  trimJournal,
  JOURNAL_VERSION,
  journalOperationId,
  mergeJournals,
  newJournalId,
  type Operation,
  type OperationKind,
  undoWarnings,
  withJournalIds,
} from "../jd/journal";
import { type JdexManagerSettings, mergeSettings } from "../settings";
import { undoOperation } from "./journal";

/** An effects array that reports every `push`, so flows written for `Effect[]` record as they go. */
export class RecordingEffects extends Array<Effect> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
  private listener: ((items: Effect[]) => void) | null = null;
  private settle: () => Promise<void> = async () => {};
  /** Wires the sink; called once by `JournalStore.begin`. */
  attach(listener: (items: Effect[]) => void, settle: () => Promise<void>): this {
    this.listener = listener;
    this.settle = settle;
    return this;
  }
  push(...items: Effect[]): number {
    const length = super.push(...items);
    if (items.length > 0) this.listener?.(items);
    return length;
  }
  /** Waits until every recorded effect reached `data.json`; throws if the last save failed. */
  flush(): Promise<void> {
    return this.settle();
  }
}

type Stored = Record<string, unknown>;

function asRecord(value: unknown): Stored {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Stored) : {};
}

function isOperation(value: unknown): value is Operation {
  const op = value as Operation | null;
  return typeof op === "object" && op !== null && Array.isArray(op.effects) && typeof op.at === "string" && typeof op.label === "string";
}

/** Paths an operation touches, for the undo shield. */
export function effectPaths(op: Operation): string[] {
  const out = new Set<string>();
  for (const e of op.effects as Partial<{ path: string; from: string; to: string }>[]) {
    for (const path of [e.path, e.from, e.to]) if (typeof path === "string") out.add(path);
  }
  return [...out];
}

export const DEVICE_KEY = "jdex-manager-device";

/** What `deviceIdentity` reads from the app. */
export interface DeviceHost {
  /** Obsidian 1.8.7 and later only (minAppVersion is 1.7.2): optional, checked before each use. */
  loadLocalStorage?(key: string): unknown;
  /** Obsidian 1.8.7 and later only, like `loadLocalStorage`. */
  saveLocalStorage?(key: string, value: unknown): void;
  vault?: { getName(): string };
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A stable id for this device and vault, never synced. Obsidian's local storage when the app has
 * it (1.8.7+); before that, the window's local storage under a key per vault name, so an older
 * Obsidian keeps one identity across restarts instead of a new one per session. An identity kept
 * by that fallback is carried into Obsidian's storage after an update, so the device stays the same.
 */
export function deviceIdentity(host: DeviceHost, make: () => string = newJournalId, storage: KeyValueStorage | null = browserStorage()): string {
  let vaultName = "";
  try {
    vaultName = host.vault?.getName() ?? "";
  } catch {
    // No vault name: one fallback key for every vault.
  }
  const fallbackKey = `${DEVICE_KEY}:${vaultName}`;
  const readFallback = (): string | null => {
    try {
      const kept = storage?.getItem(fallbackKey);
      return typeof kept === "string" && kept !== "" ? kept : null;
    } catch {
      return null;
    }
  };
  try {
    if (typeof host.loadLocalStorage === "function" && typeof host.saveLocalStorage === "function") {
      const existing = host.loadLocalStorage(DEVICE_KEY);
      if (typeof existing === "string" && existing !== "") return existing;
      const id = readFallback() ?? make();
      host.saveLocalStorage(DEVICE_KEY, id);
      return id;
    }
  } catch {
    // Obsidian's local storage failed: try the fallback.
  }
  const kept = readFallback();
  if (kept) return kept;
  const id = make();
  try {
    if (storage) {
      storage.setItem(fallbackKey, id);
      return id;
    }
  } catch {
    // Local storage unavailable: fall through to a per-session identity.
  }
  return `session-${id}`;
}

export class JournalStore {
  entries: Operation[] = [];
  removed: string[] = [];
  /** Journal fields of a newer format, written back untouched. */
  private future: Stored | null = null;
  /** Unreadable entries from an older or damaged journal, written back untouched. */
  private unreadable: unknown[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private saves: Promise<void> = Promise.resolve();
  private lastSaveError: unknown = null;

  constructor(
    readonly device: string,
    private readonly persist: () => Promise<void>,
    private readonly report: (message: string) => void = () => {},
  ) {}

  /** True when the stored journal comes from a newer version and this one must not touch it. */
  get readOnly(): boolean {
    return this.future !== null;
  }

  /** Loads the journal fields of `data.json`, migrating 0.3.x/0.4.x entries without losing them. */
  load(stored: Stored): string[] {
    const notices: string[] = [];
    const version = typeof stored.journalVersion === "number" ? stored.journalVersion : 1;
    if (version > JOURNAL_VERSION) {
      this.future = { journal: stored.journal, journalRemoved: stored.journalRemoved, journalVersion: stored.journalVersion, journalUnreadable: stored.journalUnreadable };
      this.entries = [];
      this.removed = [];
      notices.push("The undo journal was written by a newer version of JDex Manager. It is kept as it is; this version will not undo or record operations until you update.");
      return notices;
    }
    this.future = null;
    const raw = Array.isArray(stored.journal) ? (stored.journal as unknown[]) : [];
    const valid = raw.filter(isOperation);
    this.unreadable = [...(Array.isArray(stored.journalUnreadable) ? (stored.journalUnreadable as unknown[]) : []), ...raw.filter((entry) => !isOperation(entry))];
    if (raw.length > valid.length) notices.push(`${raw.length - valid.length} journal entr${raw.length - valid.length === 1 ? "y is" : "ies are"} unreadable; kept in data.json and not offered for undo.`);
    this.entries = trimJournal(withJournalIds(valid.filter((op) => op.effects.length > 0))).entries;
    this.removed = Array.isArray(stored.journalRemoved) ? (stored.journalRemoved as unknown[]).filter((id): id is string => typeof id === "string") : [];
    return notices;
  }

  /** Joins the stored journal into this one by identity. */
  absorb(stored: Stored): void {
    if (this.future) return;
    const version = typeof stored.journalVersion === "number" ? stored.journalVersion : 1;
    if (version > JOURNAL_VERSION) {
      this.load(stored);
      return;
    }
    const entries = Array.isArray(stored.journal) ? (stored.journal as unknown[]).filter(isOperation) : [];
    const removed = Array.isArray(stored.journalRemoved) ? (stored.journalRemoved as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const merged = mergeJournals({ entries: this.entries, removed: this.removed }, { entries, removed });
    this.entries = merged.entries;
    this.removed = merged.removed;
  }

  /** The journal fields to write into `data.json`. */
  serialize(): Stored {
    if (this.future) return { ...this.future };
    return {
      journal: this.entries,
      journalRemoved: this.removed,
      journalVersion: JOURNAL_VERSION,
      ...(this.unreadable.length > 0 ? { journalUnreadable: this.unreadable } : {}),
    };
  }

  last(): Operation | undefined {
    return this.entries[this.entries.length - 1];
  }

  find(id: string): Operation | undefined {
    return this.entries.find((op) => journalOperationId(op) === id);
  }

  /** Why `op` cannot be undone here, or null. Entries from before 0.5 have no device and are allowed. */
  undoRefusal(op: Operation): string | null {
    if (this.future) return "The undo journal was written by a newer version of JDex Manager; update the plugin to undo.";
    if (op.device && op.device !== this.device) return `"${op.label}" was made on another device. Undo it there, or discard the entry from the journal.`;
    return null;
  }

  /** Removes an operation by identity and remembers it, so a merge does not bring it back. */
  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((op) => journalOperationId(op) !== id);
    if (!this.removed.includes(id)) this.removed = [...this.removed, id].slice(-100);
    return this.entries.length !== before;
  }

  /** Runs `action` after every other exclusive action: undo, discard and maintenance share it. */
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(action);
    this.tail = next;
    return next;
  }

  /**
   * Runs `task` in the save queue, after every save already queued and before any queued later,
   * so it never interleaves with a save's read and write. Its failure is not a failed save.
   */
  serialized(task: () => Promise<void>): Promise<void> {
    const next = this.saves.catch(() => undefined).then(task);
    this.saves = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Queues a save; the returned promise rejects if this save fails. */
  save(): Promise<void> {
    const next = this.saves.catch(() => undefined).then(() => this.persist());
    this.saves = next.then(
      () => { this.lastSaveError = null; },
      (error: unknown) => {
        this.lastSaveError = error;
        this.report(`The undo journal could not be saved (${error instanceof Error ? error.message : String(error)}). It is kept in memory and saved with the next change.`);
      },
    );
    return next;
  }

  /**
   * Opens an operation that is recorded with its first effect and saved after each one.
   * With a journal from a newer version nothing is recorded.
   */
  begin(kind: OperationKind, label: string, auto = false): RecordingEffects {
    let op: Operation | null = null;
    const sink = new RecordingEffects();
    return sink.attach((items) => {
      if (this.future) return;
      if (!op) {
        op = { id: newJournalId(), device: this.device, kind, label, at: new Date().toISOString(), effects: [], rev: 0, ...(auto ? { auto: true } : {}) };
        ({ entries: this.entries, removed: this.removed } = appendOperation({ entries: this.entries, removed: this.removed }, op));
      }
      op.effects.push(...items.map(durableEffect));
      op.rev = (op.rev ?? 0) + 1;
      void this.save().catch(() => undefined);
    }, async () => {
      await this.saves;
      if (this.lastSaveError instanceof Error) throw this.lastSaveError;
      if (this.lastSaveError !== null) throw new Error("The undo journal could not be saved.");
    });
  }
}

/**
 * Settings changed here since they were last loaded or saved win; every other key takes the value
 * stored in `data.json`, which another device or window may have changed.
 */
export function mergeChangedSettings(local: JdexManagerSettings, baseline: JdexManagerSettings, stored: Stored): JdexManagerSettings {
  const out: Stored = { ...(local as unknown as Stored) };
  const base = baseline as unknown as Stored;
  for (const key of Object.keys(out)) {
    const changedHere = JSON.stringify(out[key]) !== JSON.stringify(base[key]);
    if (!changedHere && key in stored) out[key] = stored[key];
  }
  return mergeSettings(out);
}

const JOURNAL_FIELDS = ["journal", "journalRemoved", "journalVersion", "journalUnreadable"];

function settingsOf(stored: Stored): Partial<JdexManagerSettings> {
  const out: Stored = { ...stored };
  for (const key of JOURNAL_FIELDS) delete out[key];
  return out;
}

/** `data.json` = settings + journal. Saves are serialized and re-read before writing. */
export class PluginDataFile {
  readonly journal: JournalStore;
  private baseline: JdexManagerSettings = mergeSettings(null);

  constructor(
    private readonly io: { load(): Promise<unknown>; save(data: unknown): Promise<void> },
    readonly settings: JdexManagerSettings,
    device: string,
    report: (message: string) => void = () => {},
  ) {
    this.journal = new JournalStore(device, () => this.write(), report);
  }

  /** Loads settings and journal; returns notices about the journal for the user. */
  async load(): Promise<string[]> {
    const stored = asRecord(await this.io.load());
    Object.assign(this.settings, mergeSettings(settingsOf(stored)));
    this.baseline = JSON.parse(JSON.stringify(this.settings)) as JdexManagerSettings;
    return this.journal.load(stored);
  }

  /**
   * `data.json` changed outside this window (sync, another device): adopt it without losing local
   * entries. Queued with the saves. The baseline becomes what is on disk, not the live settings: a
   * setting changed while `data.json` was being read stays "changed here" and the next save writes it.
   */
  reload(): Promise<void> {
    return this.journal.serialized(async () => {
      const stored = asRecord(await this.io.load());
      Object.assign(this.settings, mergeChangedSettings(this.settings, this.baseline, stored));
      this.baseline = mergeSettings(settingsOf(stored));
      this.journal.absorb(stored);
    });
  }

  /** Saves settings and journal through the journal's save queue, so every write is ordered. */
  save(): Promise<void> {
    return this.journal.save();
  }

  private async write(): Promise<void> {
    const stored = asRecord(await this.io.load());
    Object.assign(this.settings, mergeChangedSettings(this.settings, this.baseline, stored));
    this.journal.absorb(stored);
    // The baseline is the copy that is written, taken before the await: a setting changed while
    // the write is in flight is not in it, so the next save still sees it as changed here.
    const written = JSON.parse(JSON.stringify(this.settings)) as JdexManagerSettings;
    await this.io.save({ ...stored, ...written, ...this.journal.serialize() });
    this.baseline = written;
  }
}

/**
 * Paths an undo just restored. Automatic maintenance and live headers leave them alone until a
 * change that does not come from the undo touches them; events that arrive while the undo runs or
 * within `settleMs` after it are the undo's own.
 */
export class UndoShield {
  private readonly paths = new Set<string>();
  private busyUntil = 0;
  private running = false;

  constructor(private readonly settleMs = 1500, private readonly now: () => number = Date.now) {}

  start(paths: string[]): void {
    this.running = true;
    for (const path of paths) this.paths.add(path);
  }

  finish(): void {
    this.running = false;
    this.busyUntil = this.now() + this.settleMs;
  }

  /** True while the undo runs or its events can still be arriving. */
  get settling(): boolean {
    return this.running || this.now() < this.busyUntil;
  }

  /** A vault event on `path`: after the settle window it is a new change and lifts the protection. */
  observe(path: string, oldPath?: string): void {
    if (this.settling) return;
    this.paths.delete(path);
    if (oldPath) this.paths.delete(oldPath);
  }

  protects(path: string): boolean {
    return this.paths.has(path);
  }

  get size(): number {
    return this.paths.size;
  }
}

export interface UndoContext {
  app: App;
  data: PluginDataFile;
  shield: UndoShield;
  confirm(title: string, lines: string[], action: string): Promise<boolean>;
  notice(message: string): void;
  /** Suppresses the plugin's own rename reactions while the undo moves files back. */
  setRenaming(value: boolean): void;
}

/**
 * Previews the last operation, then undoes exactly that operation: after the confirmation it must
 * still be the last one, or nothing runs. Operations of another device are refused; old entries
 * are only undone after a preview that warned about them.
 */
export async function undoLastOperation(ctx: UndoContext): Promise<string[] | null> {
  const journal = ctx.data.journal;
  const op = journal.last();
  if (!op) {
    ctx.notice("Nothing to undo: the journal is empty.");
    return null;
  }
  const refusal = journal.undoRefusal(op);
  if (refusal) {
    ctx.notice(refusal);
    return null;
  }
  const id = journalOperationId(op);
  const warnings = undoWarnings(op);
  const ok = await ctx.confirm(`Undo "${op.label}"?`, [...describeUndo(op), ...warnings, "Nothing is deleted outright: notes and folders go to the trash."], "Undo");
  if (!ok) return null;
  return journal.exclusive(async () => {
    const current = journal.last();
    if (!current || journalOperationId(current) !== id) {
      ctx.notice("The journal changed while you were confirming; nothing was undone. Run undo again to see the current last operation.");
      return null;
    }
    ctx.shield.start(effectPaths(current));
    ctx.setRenaming(true);
    try {
      const done = await undoOperation(ctx.app, current, async () => {
        if (current.effects.length === 0) journal.remove(id);
        await ctx.data.save();
      }, { confirmedLegacy: warnings.length > 0 });
      ctx.notice(done.length > 0 ? done.join(" · ") : `"${current.label}" had nothing left to undo.`);
      return done;
    } catch (error) {
      ctx.notice(`Undo stopped: ${error instanceof Error ? error.message : String(error)}. The operation stays in the journal.`);
      return null;
    } finally {
      ctx.setRenaming(false);
      ctx.shield.finish();
    }
  });
}

/**
 * Drops the last entry without touching any file: the way out of an entry that cannot be undone
 * (an edited note, a step from another version, an operation of another device).
 */
export async function discardLastOperation(ctx: Pick<UndoContext, "data" | "confirm" | "notice">): Promise<boolean> {
  const journal = ctx.data.journal;
  const op = journal.last();
  if (!op || journal.readOnly) {
    ctx.notice(journal.readOnly ? "The undo journal was written by a newer version of JDex Manager; update the plugin to change it." : "Nothing to discard: the journal is empty.");
    return false;
  }
  const id = journalOperationId(op);
  const ok = await ctx.confirm(`Discard "${op.label}" from the journal?`, [
    "No file changes: the entry is only removed from the undo journal, so the previous operation becomes the last one.",
    `${op.effects.length} step(s) of this operation will no longer be undoable.`,
  ], "Discard");
  if (!ok) return false;
  return journal.exclusive(async () => {
    const current = journal.last();
    if (!current || journalOperationId(current) !== id) {
      ctx.notice("The journal changed while you were confirming; nothing was discarded.");
      return false;
    }
    journal.remove(id);
    await ctx.data.save();
    ctx.notice(`Discarded "${current.label}" from the journal.`);
    return true;
  });
}
