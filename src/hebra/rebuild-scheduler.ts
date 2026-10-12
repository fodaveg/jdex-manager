/**
 * When the Hebra runtime rebuilds or refreshes the JDex index (audit 12 Oct 2026, 5.1).
 *
 * The runtime owns the state (walk, index, findings) and how to compute it; this module only
 * decides WHEN: the debounce of host notices, the full-versus-by-id choice, the generation
 * that lets a newer rebuild overtake an older one, the retry with backoff and its cap, and
 * shutdown. The clock and the two ways of computing the state are injected, so every rule
 * here is tested without the host API or the DOM (`tests/hebra/rebuild-scheduler.test.ts`).
 */

/** A `library-changed` storm (sync bringing many notes) does not rebuild once per notice. */
export const REBUILD_DEBOUNCE_MS = 800;
/** After this many failures in a row, the automatic retry stops. */
export const MAX_REBUILD_FAILURES = 5;
export const MAX_REBUILD_DELAY_MS = 30_000;
/** Longest a pending notice waits while new notices keep re-arming the debounce. */
export const MAX_BATCH_WAIT_MS = 3_000;

/** Reasons that change nothing JDex indexes (title, folder, state, JDex frontmatter). */
const IRRELEVANT_REASONS: ReadonlySet<string> = new Set(['favorite', 'hide']);
/** Reasons resolved by ids, each with its effect:
 *   - `save`: body, title and frontmatter (the note keeps its folder and state);
 *   - `create`: added; `purge`: removed for good;
 *   - `trash`, `restore`, `archive`: membership off and on (live, not archived);
 *   - `move`: new folder, inside or outside the system or the JDex folder;
 *   - `resolve`: the conflict copy discarded or adopted;
 *   - `sync`: what another device brings (few ids; more than one `note_summary` rebuilds).
 *  Anything else (`import`, or a reason not known) rebuilds in full, as before PERF-07. */
const INCREMENTAL_REASONS: ReadonlySet<string> = new Set([
  'save',
  'create',
  'purge',
  'trash',
  'restore',
  'archive',
  'move',
  'resolve',
  'sync'
]);

export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The global timers, looked up at each call (fake timers installed later still apply). */
export const SYSTEM_CLOCK: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface RebuildSchedulerDeps {
  clock?: SchedulerClock;
  /** Walks the library from scratch and applies the result. `isCurrent()` turns false when
   *  a newer rebuild started meanwhile: then nothing is applied and it returns
   *  `'superseded'` (whoever awaited this rebuild then waits for the newer one). */
  fullRebuild(isCurrent: () => boolean): Promise<'superseded' | void>;
  /** Applies the changes of the notes `ids` to the current state. `'retry'`: the state was
   *  replaced while reading, apply them again to the new one. `'rebuild'`: only a full walk
   *  resolves them. `isCurrent()` turns false when a full rebuild started meanwhile (its
   *  read is newer: apply nothing). */
  refreshIds(ids: readonly string[], isCurrent: () => boolean): Promise<'retry' | 'rebuild' | void>;
  /** Writes derived from the index (headers, system index, frontmatter) after a batch. */
  syncDerived(): Promise<void>;
  /** Folder paths of the current walk; `null` before the first one lands. */
  folderPaths(): ReadonlyMap<string, string> | null;
  /** Whether the note is or was indexed since activation (a save is never dropped then). */
  isIndexed(id: string): boolean;
  /** Notes the plugin writes itself (the debug log): never queued for a refresh. */
  isOwn(id: string): boolean;
  report(error: unknown, where: string): void;
  /** First failure of `syncDerived` since the last batch that ended well. */
  derivedFailed(error: unknown): void;
}

export interface RebuildScheduler {
  /** Full rebuild now. Resolves when its result (or a newer one's) is applied. */
  rebuild(): Promise<void>;
  /** Refreshes only these notes, one refresh after another (each starts from the state the
   *  previous one left, so two finishing in reverse order cannot drop each other's notes). */
  refreshNotes(ids: readonly string[]): Promise<void>;
  /** A change of folder structure or settings: full rebuild after the debounce. */
  scheduleRebuild(): void;
  /** A folders notice with its snapshot of paths. */
  foldersChanged(paths: ReadonlyMap<string, string>): void;
  /** A folders notice emitted by our own write needs no second walk after that write's
   *  rebuild; a different snapshot stays queued for the next batch. */
  settleFolderChanges(): void;
  /** A notes notice from the host. */
  notesChanged(reason: string, ids: readonly string[]): void;
  /** A rebuild failed outside a batch (the first one): enter the retry path. */
  retryAfterFailure(): void;
  /** Waits for every rebuild and refresh in flight and applies what notices left pending,
   *  without the derived writes (those stay for the batch). Used right before a write that
   *  must not rely on a stale walk. Never waits for the journal, so it can run inside an
   *  operation. */
  settle(): Promise<void>;
  /** Turned off: no timer, retry or batch is armed again. */
  dispose(): void;
}

export function createRebuildScheduler(deps: RebuildSchedulerDeps): RebuildScheduler {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  /** Generation of the latest FULL rebuild requested: one that ends when a newer one exists
   *  does not overwrite the index (its read is older). */
  let generation = 0;
  let latestRebuild: Promise<void> = Promise.resolve();
  /** Rebuilds and refreshes in flight: while any runs, a save is not dropped for not being
   *  in the walk (the note may be about to enter it). */
  let busy = 0;
  /** Every by-id refresh applies its result in this one queue. It never waits for the
   *  journal or for a batch, so a batch can await it without a cycle. */
  let refreshTail: Promise<void> = Promise.resolve();
  /** By-id batches run one after another. */
  let notesTail: Promise<void> = Promise.resolve();
  let rebuildTimer: unknown = null;
  /** When the oldest unprocessed notice arrived. */
  let batchSince: number | null = null;
  let pendingFull = false;
  let pendingFolderPaths: ReadonlyMap<string, string> | null = null;
  const pendingIds = new Set<string>();
  /** Failures in a row (back to 0 ONLY when a batch ends well; a notice does not reset it,
   *  or a deterministic failure under continuous autosave would re-arm the 800 ms retry
   *  forever): the retry backs off and gives up after `MAX_REBUILD_FAILURES`. Past the
   *  cap, each notice gives ONE attempt (one more failure arms no timer). */
  let failures = 0;
  let derivedFailureNotified = false;
  let disposed = false;

  function rebuild(): Promise<void> {
    const gen = ++generation;
    busy += 1;
    const run = runRebuild(gen).finally(() => {
      busy -= 1;
    });
    latestRebuild = run;
    return run;
  }

  async function runRebuild(gen: number): Promise<void> {
    const outcome = await deps.fullRebuild(() => gen === generation);
    // Overtaken by a newer one while reading: its result is the one to wait for.
    if (outcome === 'superseded') return latestRebuild;
  }

  /** Waits until no full rebuild is in flight (if another starts meanwhile, that one too). */
  async function rebuildsSettled(): Promise<void> {
    let seen: number;
    do {
      seen = generation;
      await latestRebuild.catch(() => undefined);
    } while (seen !== generation);
  }

  function refreshNotes(ids: readonly string[]): Promise<void> {
    busy += 1;
    const run = refreshTail.then(() => refreshNow(ids));
    refreshTail = run.catch(() => undefined);
    return run.finally(() => {
      busy -= 1;
    });
  }

  async function refreshNow(ids: readonly string[]): Promise<void> {
    for (;;) {
      // A rebuild in flight lands first; one started while waiting is waited for too.
      await rebuildsSettled();
      if (disposed) return;
      const gen = generation;
      const outcome = await deps.refreshIds(ids, () => gen === generation);
      if (outcome === 'retry') continue;
      if (outcome === 'rebuild') await rebuild();
      return;
    }
  }

  function armBatchTimer(delayMs: number = REBUILD_DEBOUNCE_MS, capped = true): void {
    if (disposed) return;
    if (rebuildTimer !== null) clock.clearTimeout(rebuildTimer);
    if (capped) {
      batchSince ??= clock.now();
      delayMs = Math.max(0, Math.min(delayMs, MAX_BATCH_WAIT_MS - (clock.now() - batchSince)));
    }
    rebuildTimer = clock.setTimeout(() => {
      rebuildTimer = null;
      batchSince = null;
      void flushBatch();
    }, delayMs);
  }

  /** A rebuild or refresh failed: full rebuild with exponential backoff (800 ms, 1.6 s,
   *  3.2 s…, capped at 30 s) and, after `MAX_REBUILD_FAILURES` in a row, stop WITHOUT a
   *  timer: `pendingFull` waits and the next notes or folders notice rebuilds in full.
   *  Turned off, nothing (a closed port would fail forever). */
  function retryAfterFailure(): void {
    if (disposed) return;
    failures += 1;
    pendingFull = true;
    if (failures >= MAX_REBUILD_FAILURES) return;
    armBatchTimer(Math.min(REBUILD_DEBOUNCE_MS * 2 ** (failures - 1), MAX_REBUILD_DELAY_MS), false);
  }

  /** `syncDerived` failed (a write the host rejects, a journal it cannot save): that is not
   *  a stale index, so no full rebuild. One notice until a batch succeeds again. */
  function reportDerivedFailure(error: unknown): void {
    deps.report(error, 'mantener-derivados');
    if (disposed || derivedFailureNotified) return;
    derivedFailureNotified = true;
    deps.derivedFailed(error);
  }

  function scheduleRebuild(): void {
    pendingFull = true;
    armBatchTimer();
  }

  function sameFolderPaths(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
    return left.size === right.size && [...left].every(([id, path]) => right.get(id) === path);
  }

  function settleFolderChanges(): void {
    const current = deps.folderPaths();
    if (current && pendingFolderPaths && sameFolderPaths(current, pendingFolderPaths)) {
      pendingFolderPaths = null;
      pendingFull = false;
    }
  }

  async function flushBatch(): Promise<void> {
    const full = pendingFull;
    const ids = [...pendingIds];
    pendingFull = false;
    pendingIds.clear();
    if (!full && ids.length === 0) return;
    // Only a failed rebuild or refresh asks for another full rebuild; a failed derived
    // write is reported once. By-id batches go one after another (`notesTail`); a full one
    // does not wait for them (a newer rebuild must be able to overtake a slow one).
    const batch = async (): Promise<void> => {
      try {
        if (full) {
          await rebuild();
          settleFolderChanges();
        } else {
          await refreshNotes(ids);
        }
      } catch (error) {
        deps.report(error, full ? 'rebuild' : 'actualizar-notas');
        // Without this a failure would leave the walk stale (or empty), or a note whose
        // read failed out of the index, until the next notice.
        retryAfterFailure();
        return;
      }
      try {
        await deps.syncDerived();
      } catch (error) {
        reportDerivedFailure(error);
        return;
      }
      failures = 0;
      derivedFailureNotified = false;
    };
    busy += 1;
    try {
      if (full) {
        await batch();
        return;
      }
      notesTail = notesTail.then(batch);
      await notesTail;
    } finally {
      busy -= 1;
    }
  }

  function notesChanged(reason: string, ids: readonly string[]): void {
    if (IRRELEVANT_REASONS.has(reason)) return;
    if (!INCREMENTAL_REASONS.has(reason)) {
      scheduleRebuild();
      return;
    }
    // A save of a note outside the walk cannot change the index (saving neither moves it
    // nor restores it): nothing to ask. Only at rest; with anything in flight the note
    // could be about to enter.
    if (
      reason === 'save' &&
      deps.folderPaths() !== null &&
      !pendingFull &&
      busy === 0 &&
      rebuildTimer === null &&
      ids.every((id) => !deps.isIndexed(id) && !pendingIds.has(id))
    ) {
      return;
    }
    for (const id of ids) if (!deps.isOwn(id)) pendingIds.add(id);
    armBatchTimer();
  }

  async function settle(): Promise<void> {
    await rebuildsSettled();
    await refreshTail;
    // A refresh may have asked for a rebuild: wait for that one as well.
    await rebuildsSettled();
    if (disposed) return;
    // The batch still runs later (with the derived writes); here only the state is updated.
    if (pendingFull) await rebuild();
    else if (pendingIds.size > 0) await refreshNotes([...pendingIds]);
  }

  return {
    rebuild,
    refreshNotes,
    scheduleRebuild,
    foldersChanged(paths) {
      pendingFolderPaths = paths;
      scheduleRebuild();
    },
    settleFolderChanges,
    notesChanged,
    retryAfterFailure,
    settle,
    dispose() {
      disposed = true;
      if (rebuildTimer !== null) clock.clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
  };
}
