/**
 * Code review of 12 Oct 2026, finding 1: a setting changed while `data.json` is being written (or
 * re-read) must not enter the baseline unwritten, or the next save reverts it in memory and on disk.
 */
import { describe, expect, it, vi } from "vitest";
import type { Effect } from "../src/jd/journal";
import { mergeSettings } from "../src/jd/settings";
import { PluginDataFile } from "../src/vault/journal-store";

const created = (path: string): Effect => ({ kind: "created-note", path, content: path });

/** A data file whose next `save` (or `load`) can be held open while the test changes a setting. */
function heldDataFile(initial: Record<string, unknown>) {
  let stored: unknown = JSON.parse(JSON.stringify(initial));
  let holdSave: Promise<void> | null = null;
  let holdLoad: Promise<void> | null = null;
  const io = {
    load: vi.fn(async (): Promise<unknown> => {
      const snapshot = JSON.parse(JSON.stringify(stored)) as unknown;
      if (holdLoad) await holdLoad;
      return snapshot;
    }),
    save: vi.fn(async (data: unknown) => {
      const snapshot = JSON.parse(JSON.stringify(data)) as unknown;
      if (holdSave) await holdSave;
      stored = snapshot;
    }),
  };
  const settings = mergeSettings(null);
  const data = new PluginDataFile(io, settings, "dev-A");
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  };
  return {
    data, settings, io,
    stored: () => stored as Record<string, unknown>,
    holdNextSave() { const g = gate(); holdSave = g.promise; return () => { holdSave = null; g.release(); }; },
    holdNextLoad() { const g = gate(); holdLoad = g.promise; return () => { holdLoad = null; g.release(); }; },
  };
}

/** Lets queued promise callbacks run (no timers: the plugin lint wants `activeWindow` ones). */
const tick = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

describe("Settings changed while data.json is being written (finding 1)", () => {
  it("a setting changed during a journal save survives the next save, in memory and on disk", async () => {
    const file = heldDataFile({ jdexFolder: "J", dateFormat: "YYYY-MM-DD" });
    await file.data.load();
    const release = file.holdNextSave();
    const sink = file.data.journal.begin("fix", "Journal write");
    sink.push(created("J/a.md"));
    await tick();
    expect(file.io.save).toHaveBeenCalledTimes(1);
    // The user changes a setting while the journal save is still in flight, then saves it.
    file.settings.dateFormat = "YYYY-MM";
    const settingsSave = file.data.save();
    release();
    await sink.flush();
    await settingsSave;
    expect(file.settings.dateFormat).toBe("YYYY-MM");
    expect(file.stored().dateFormat).toBe("YYYY-MM");
    // And a later journal save does not revert it either.
    file.data.journal.begin("fix", "Another").push(created("J/b.md"));
    await file.data.save();
    expect(file.settings.dateFormat).toBe("YYYY-MM");
    expect(file.stored().dateFormat).toBe("YYYY-MM");
  });

  it("control: a setting changed after the journal save completed is kept", async () => {
    const file = heldDataFile({ jdexFolder: "J", dateFormat: "YYYY-MM-DD" });
    await file.data.load();
    const sink = file.data.journal.begin("fix", "Journal write");
    sink.push(created("J/a.md"));
    await sink.flush();
    file.settings.dateFormat = "YYYY-MM";
    await file.data.save();
    expect(file.settings.dateFormat).toBe("YYYY-MM");
    expect(file.stored().dateFormat).toBe("YYYY-MM");
  });

  it("a setting changed while data.json is re-read after an external change is still written", async () => {
    const file = heldDataFile({ jdexFolder: "J", dateFormat: "YYYY-MM-DD" });
    await file.data.load();
    const release = file.holdNextLoad();
    const reload = file.data.reload();
    await tick();
    file.settings.dateFormat = "YYYY-MM";
    release();
    await reload;
    await file.data.save();
    expect(file.settings.dateFormat).toBe("YYYY-MM");
    expect(file.stored().dateFormat).toBe("YYYY-MM");
  });

  it("reload waits for a save in flight, so it never reads data.json between a save's read and write", async () => {
    const file = heldDataFile({ jdexFolder: "J", journal: [], journalVersion: 2 });
    await file.data.load();
    const release = file.holdNextSave();
    file.data.journal.begin("fix", "In flight").push(created("J/a.md"));
    await tick();
    const loadsBefore = file.io.load.mock.calls.length;
    const reload = file.data.reload();
    await tick();
    // Queued behind the save: it has not read data.json yet.
    expect(file.io.load.mock.calls.length).toBe(loadsBefore);
    release();
    await reload;
    expect(file.io.load.mock.calls.length).toBe(loadsBefore + 1);
    expect(file.data.journal.entries.map((op) => op.label)).toEqual(["In flight"]);
  });
});
