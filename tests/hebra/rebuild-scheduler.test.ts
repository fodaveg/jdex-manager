/**
 * The rebuild scheduler on its own (audit 12 Oct 2026, 5.1): debounce, retry with backoff
 * and its cap, shutdown and generations, with an injected clock and no host API or DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  createRebuildScheduler,
  MAX_BATCH_WAIT_MS,
  REBUILD_DEBOUNCE_MS,
  type RebuildSchedulerDeps,
  type SchedulerClock
} from '../../src/hebra/rebuild-scheduler';

/** Lets every pending promise continuation run (a real macrotask; no fake timers here). */
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function manualClock() {
  let time = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: SchedulerClock = {
    now: () => time,
    setTimeout: (run, ms) => {
      timers.set(++seq, { at: time + ms, run });
      return seq;
    },
    clearTimeout: (handle) => void timers.delete(handle as number)
  };
  /** Moves the clock `ms` forward, firing each due timer in order and draining after it. */
  async function advance(ms: number): Promise<void> {
    const end = time + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].run();
      await drain();
    }
    time = end;
    await drain();
  }
  return { clock, advance, armed: () => timers.size };
}

function setup(overrides: Partial<RebuildSchedulerDeps> = {}) {
  const { clock, advance, armed } = manualClock();
  const calls = { full: 0, ids: [] as string[][], derived: 0, derivedFailed: 0, reports: [] as string[] };
  let walked = false;
  const scheduler = createRebuildScheduler({
    clock,
    fullRebuild: async () => {
      calls.full += 1;
      walked = true;
    },
    refreshIds: async (ids) => void calls.ids.push([...ids]),
    syncDerived: async () => void (calls.derived += 1),
    folderPaths: () => (walked ? new Map([['f', 'Carpeta']]) : null),
    isIndexed: (id) => id.startsWith('known'),
    isOwn: (id) => id === 'log',
    report: (_error, where) => void calls.reports.push(where),
    derivedFailed: () => void (calls.derivedFailed += 1),
    ...overrides
  });
  return { scheduler, calls, advance, armed };
}

describe('rebuild scheduler: debounce', () => {
  it('notices inside the debounce become one by-id refresh, then the derived writes', async () => {
    const { scheduler, calls, advance } = setup();
    scheduler.notesChanged('create', ['a']);
    await advance(REBUILD_DEBOUNCE_MS - 100);
    scheduler.notesChanged('sync', ['b']);
    await advance(REBUILD_DEBOUNCE_MS - 1);
    expect(calls.ids).toEqual([]);
    await advance(1);
    expect(calls.ids).toEqual([['a', 'b']]);
    expect(calls.derived).toBe(1);
  });

  it('a steady stream of notices still flushes after MAX_BATCH_WAIT_MS', async () => {
    const { scheduler, calls, advance } = setup();
    for (let elapsed = 0; elapsed < MAX_BATCH_WAIT_MS; elapsed += 500) {
      scheduler.notesChanged('save', [`known-${elapsed}`]);
      await advance(500);
    }
    expect(calls.ids).toHaveLength(1);
    expect(calls.ids[0]).toHaveLength(6);
  });

  it('an unknown reason rebuilds in full; favourite and hide do nothing', async () => {
    const { scheduler, calls, advance, armed } = setup();
    scheduler.notesChanged('favorite', ['a']);
    scheduler.notesChanged('hide', ['a']);
    expect(armed()).toBe(0);
    scheduler.notesChanged('import', ['a']);
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls).toMatchObject({ full: 1, ids: [] });
  });

  it('at rest, saving a note never indexed is dropped; an indexed one is queued', async () => {
    const { scheduler, calls, advance, armed } = setup();
    await scheduler.rebuild();
    scheduler.notesChanged('save', ['stranger']);
    expect(armed()).toBe(0);
    scheduler.notesChanged('save', ['known-1', 'log']);
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls.ids).toEqual([['known-1']]);
  });
});

describe('rebuild scheduler: retry and cap', () => {
  it('a failing rebuild retries at 800 ms, 1.6 s, 3.2 s, 6.4 s and stops after five failures', async () => {
    const { scheduler, calls, advance, armed } = setup({ fullRebuild: async () => { calls.full += 1; throw new Error('roto'); } });
    await scheduler.rebuild().catch(() => scheduler.retryAfterFailure());
    for (const wait of [800, 1600, 3200, 6400]) {
      await advance(wait - 1);
      const before = calls.full;
      await advance(1);
      expect(calls.full).toBe(before + 1);
    }
    expect(calls.full).toBe(5);
    expect(armed()).toBe(0);
  });

  it('past the cap, each notice gives one attempt and arms no timer', async () => {
    const { scheduler, calls, advance, armed } = setup({ fullRebuild: async () => { calls.full += 1; throw new Error('roto'); } });
    await scheduler.rebuild().catch(() => scheduler.retryAfterFailure());
    await advance(60_000);
    scheduler.notesChanged('sync', ['a']);
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls.full).toBe(6);
    expect(armed()).toBe(0);
  });

  it('a batch that ends well resets the count, so the backoff starts again at 800 ms', async () => {
    let fail = true;
    const { scheduler, calls, advance } = setup({ fullRebuild: async () => { calls.full += 1; if (fail) throw new Error('roto'); } });
    await scheduler.rebuild().catch(() => scheduler.retryAfterFailure());
    fail = false;
    await advance(800);
    fail = true;
    scheduler.scheduleRebuild();
    await advance(REBUILD_DEBOUNCE_MS);
    await advance(800);
    expect(calls.full).toBe(4);
  });

  it('a failing derived write is notified once until a batch ends well, without a rebuild', async () => {
    let derivedFails = true;
    const { scheduler, calls, advance } = setup({ syncDerived: async () => { if (derivedFails) throw new Error('rechazada'); } });
    for (const id of ['known-1', 'known-2']) {
      scheduler.notesChanged('create', [id]);
      await advance(REBUILD_DEBOUNCE_MS);
    }
    expect(calls).toMatchObject({ full: 0, derivedFailed: 1 });
    expect(calls.reports).toEqual(['mantener-derivados', 'mantener-derivados']);
    derivedFails = false;
    scheduler.notesChanged('create', ['known-3']);
    await advance(REBUILD_DEBOUNCE_MS);
    derivedFails = true;
    scheduler.notesChanged('create', ['known-4']);
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls.derivedFailed).toBe(2);
  });
});

describe('rebuild scheduler: shutdown', () => {
  it('dispose clears the pending timer and no notice or failure arms another', async () => {
    const { scheduler, calls, advance, armed } = setup();
    scheduler.notesChanged('create', ['a']);
    scheduler.dispose();
    expect(armed()).toBe(0);
    scheduler.notesChanged('create', ['b']);
    scheduler.retryAfterFailure();
    await advance(60_000);
    expect(calls).toMatchObject({ full: 0, ids: [] });
  });

  it('a refresh queued before dispose does not read after it', async () => {
    const { scheduler, calls } = setup();
    const refresh = scheduler.refreshNotes(['a']);
    scheduler.dispose();
    await refresh;
    expect(calls.ids).toEqual([]);
  });
});

describe('rebuild scheduler: generations and ordering', () => {
  it('a superseded rebuild resolves only when the newer one has landed', async () => {
    const releases: Array<() => void> = [];
    const order: string[] = [];
    const { scheduler } = setup({
      fullRebuild: (isCurrent) => new Promise((resolve) => releases.push(() => resolve(isCurrent() ? undefined : 'superseded')))
    });
    const first = scheduler.rebuild().then(() => order.push('first'));
    const second = scheduler.rebuild().then(() => order.push('second'));
    releases[0]();
    await drain();
    expect(order).toEqual([]);
    releases[1]();
    await Promise.all([first, second]);
    expect(order).toEqual(['second', 'first']);
  });

  it('a by-id refresh retries on the replaced state and falls back to a full rebuild', async () => {
    const answers: Array<'retry' | 'rebuild' | void> = ['retry', 'rebuild'];
    const { scheduler, calls } = setup({ refreshIds: async (ids) => { calls.ids.push([...ids]); return answers.shift(); } });
    await scheduler.refreshNotes(['a']);
    expect(calls.ids).toEqual([['a'], ['a']]);
    expect(calls.full).toBe(1);
  });

  it('a folders notice from our own write is settled by that write and needs no second walk', async () => {
    const { scheduler, calls, advance } = setup();
    scheduler.foldersChanged(new Map([['f', 'Carpeta']]));
    await scheduler.rebuild();
    scheduler.settleFolderChanges();
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls.full).toBe(1);
  });

  it('settle applies what notices left pending, before the timer and without the derived writes', async () => {
    const { scheduler, calls, advance } = setup();
    scheduler.notesChanged('create', ['a']);
    await scheduler.settle();
    expect(calls).toMatchObject({ ids: [['a']], derived: 0 });
    scheduler.scheduleRebuild();
    await scheduler.settle();
    expect(calls.full).toBe(1);
    await advance(REBUILD_DEBOUNCE_MS);
    expect(calls.derived).toBe(1);
  });
});
