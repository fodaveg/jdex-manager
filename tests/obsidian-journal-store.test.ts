import { describe, expect, it, vi } from "vitest";
import { type Effect, JOURNAL_VERSION, mergeJournals, type Operation } from "../src/jd/journal";
import { mergeSettings } from "../src/jd/settings";
import { deviceIdentity, discardLastOperation, PluginDataFile, UndoShield, undoLastOperation, type UndoContext } from "../src/vault/journal-store";
import { fakeVault } from "./support/fake-obsidian-vault";

function dataFile(initial: unknown = null, device = "dev-A") {
  let stored: unknown = initial === null ? null : JSON.parse(JSON.stringify(initial));
  const io = {
    load: vi.fn(async (): Promise<unknown> => (stored === null ? null : JSON.parse(JSON.stringify(stored)) as unknown)),
    save: vi.fn(async (data: unknown) => { stored = JSON.parse(JSON.stringify(data)); }),
  };
  const settings = mergeSettings(null);
  const notices: string[] = [];
  const data = new PluginDataFile(io, settings, device, (message) => notices.push(message));
  return { data, io, settings, notices, stored: () => stored as Record<string, unknown>, setStored: (value: unknown) => { stored = JSON.parse(JSON.stringify(value)); } };
}

function context(app: UndoContext["app"], data: PluginDataFile, confirm: UndoContext["confirm"] = async () => true) {
  const notices: string[] = [];
  return { notices, ctx: { app, data, shield: new UndoShield(), confirm, notice: (message: string) => notices.push(message), setRenaming: () => {} } satisfies UndoContext };
}

const created = (path: string, content: string): Effect => ({ kind: "created-note", path, content });

describe("Obsidian undo acts on the confirmed operation", () => {
  it("does nothing when maintenance records an operation during the dialog (inverted probe)", async () => {
    const v = fakeVault();
    v.file("J/a.md", "A");
    const { data } = dataFile();
    await data.load();
    const sink = data.journal.begin("create-id", "Create a");
    sink.push(created("J/a.md", "A"));
    await sink.flush();
    const { ctx, notices } = context(v.app, data, async () => {
      v.file("J/h.md", "H2");
      const maintenance = data.journal.begin("fix", "Automatic JDex maintenance");
      maintenance.push({ kind: "note-rewrite", path: "J/h.md", before: "H1", after: "H2" });
      await maintenance.flush();
      return true;
    });
    expect(await undoLastOperation(ctx)).toBeNull();
    expect(notices.join(" ")).toContain("journal changed");
    expect(data.journal.entries.map((op) => op.label)).toEqual(["Create a", "Automatic JDex maintenance"]);
    expect(data.journal.entries.every((op) => op.effects.length > 0)).toBe(true);
    expect(v.exists("J/a.md")).toBe(true);
    expect(v.bodies.get("J/h.md")).toBe("H2");
  });

  it("undoes exactly the confirmed operation and leaves no empty entry (control)", async () => {
    const v = fakeVault();
    v.file("J/a.md", "A");
    const { data, stored } = dataFile();
    await data.load();
    data.journal.begin("create-id", "Create a").push(created("J/a.md", "A"));
    await data.save();
    const { ctx } = context(v.app, data);
    expect(await undoLastOperation(ctx)).toEqual(["Trashed J/a.md."]);
    expect(data.journal.entries).toEqual([]);
    expect(stored().journal).toEqual([]);
    expect((stored().journalRemoved as string[]).length).toBe(1);
  });

  it("never loads or keeps an operation without effects", async () => {
    const { data } = dataFile({ journal: [{ kind: "fix", label: "Empty", at: "2026-10-01T00:00:00.000Z", effects: [] }] });
    await data.load();
    expect(data.journal.entries).toEqual([]);
  });

  it("refuses an operation made on another device, which can still be discarded", async () => {
    const v = fakeVault();
    v.file("J/a.md", "A");
    const op: Operation = { id: "op-b", device: "dev-B", kind: "create-id", label: "Create a", at: "2026-10-01T00:00:00.000Z", effects: [created("J/a.md", "A")] };
    const { data } = dataFile({ journal: [op], journalVersion: JOURNAL_VERSION });
    await data.load();
    const { ctx, notices } = context(v.app, data);
    expect(await undoLastOperation(ctx)).toBeNull();
    expect(notices.join(" ")).toContain("another device");
    expect(v.exists("J/a.md")).toBe(true);
    expect(await discardLastOperation(ctx)).toBe(true);
    expect(data.journal.entries).toEqual([]);
    expect(v.exists("J/a.md")).toBe(true);
  });
});

describe("Discarding a journal entry", () => {
  it("lets the previous operation be undone after an edited note blocks the last one", async () => {
    const v = fakeVault();
    v.file("J/a.md", "A");
    v.file("J/b.md", "B");
    const { data } = dataFile();
    await data.load();
    data.journal.begin("create-id", "Create a").push(created("J/a.md", "A"));
    data.journal.begin("create-id", "Create b").push(created("J/b.md", "B"));
    v.bodies.set("J/b.md", "B edited");
    const { ctx, notices } = context(v.app, data);
    expect(await undoLastOperation(ctx)).toBeNull();
    expect(notices.join(" ")).toContain("edited after creation");
    expect(data.journal.entries).toHaveLength(2);
    expect(await discardLastOperation(ctx)).toBe(true);
    expect(v.bodies.get("J/b.md")).toBe("B edited");
    expect(data.journal.entries.map((op) => op.label)).toEqual(["Create a"]);
    expect(await undoLastOperation(ctx)).toEqual(["Trashed J/a.md."]);
    expect(v.exists("J/a.md")).toBe(false);
    expect(v.exists("J/b.md")).toBe(true);
  });
});

describe("data.json changed elsewhere", () => {
  it("keeps an external jdexFolder and an external journal entry when saving locally", async () => {
    const file = dataFile({ jdexFolder: "Old", journal: [], journalVersion: JOURNAL_VERSION });
    await file.data.load();
    const remote: Operation = { id: "op-b", device: "dev-B", kind: "fix", label: "Remote", at: "2026-10-01T00:00:00.000Z", effects: [created("J/r.md", "R")], rev: 1 };
    file.setStored({ ...file.stored(), jdexFolder: "New", journal: [remote] });
    file.settings.dateFormat = "YYYY-MM";
    file.data.journal.begin("fix", "Local").push(created("J/l.md", "L"));
    await file.data.save();
    expect(file.stored().jdexFolder).toBe("New");
    expect(file.stored().dateFormat).toBe("YYYY-MM");
    expect((file.stored().journal as Operation[]).map((op) => op.label)).toEqual(["Remote", "Local"]);
    expect(file.settings.jdexFolder).toBe("New");
  });

  it("reloads settings and joins the journal when Obsidian reports an external change", async () => {
    const file = dataFile({ jdexFolder: "Old", journalVersion: JOURNAL_VERSION, journal: [] });
    await file.data.load();
    file.data.journal.begin("fix", "Local").push(created("J/l.md", "L"));
    await file.data.journal.begin("fix", "Local").flush();
    const local = file.data.journal.entries[0];
    file.setStored({ jdexFolder: "Synced", journalVersion: JOURNAL_VERSION, journal: [] });
    await file.data.reload();
    expect(file.settings.jdexFolder).toBe("Synced");
    expect(file.data.journal.entries).toEqual([local]);
  });

  it("does not bring back an operation undone here from a stale copy", () => {
    const op: Operation = { id: "x", kind: "fix", label: "X", at: "2026-10-01T00:00:00.000Z", effects: [created("a", "A")] };
    expect(mergeJournals({ entries: [], removed: ["x"] }, { entries: [op], removed: [] }).entries).toEqual([]);
  });

  it("orders by date, keeps the newest revision of the same operation and drops emptied ones", () => {
    const a1: Operation = { id: "a", kind: "fix", label: "A", at: "2026-10-01T00:00:01.000Z", effects: [created("a", "1"), created("b", "2")], rev: 2 };
    const a2: Operation = { ...a1, effects: [created("a", "1")], rev: 3 };
    const b: Operation = { id: "b", kind: "fix", label: "B", at: "2026-10-01T00:00:00.000Z", effects: [created("c", "3")], rev: 1 };
    const merged = mergeJournals({ entries: [a1], removed: [] }, { entries: [a2, b], removed: [] });
    expect(merged.entries.map((op) => [op.id, op.effects.length])).toEqual([["b", 1], ["a", 1]]);
  });
});

describe("Per-effect persistence", () => {
  it("saves data.json once per effect and keeps effects recorded before a failure", async () => {
    const { data, io, stored } = dataFile();
    await data.load();
    const sink = data.journal.begin("fix", "Repair");
    sink.push(created("a", "A"));
    sink.push(created("b", "B"));
    sink.push(created("c", "C"));
    await sink.flush();
    expect(io.save).toHaveBeenCalledTimes(3);
    expect((stored().journal as Operation[])[0].effects).toHaveLength(3);
  });
});

describe("Journals from other versions", () => {
  it("does not mark a 0.3.1 frontmatter step with lost keys as undone, and warns", async () => {
    const v = fakeVault();
    v.file("J/21.11 X.md", "# 21.11 X\n", { tipo: "archivado", archivado: "2026-09-01" });
    const legacy = { kind: "retire", label: "Retire 21.11", at: "2026-09-01T10:00:00.000Z", effects: [{ kind: "frontmatter", path: "J/21.11 X.md", previous: {} }] };
    const file = dataFile({ jdexFolder: "J", journal: [legacy] });
    await file.data.load();
    const lines: string[] = [];
    const { ctx, notices } = context(v.app, file.data, async (_title, preview) => { lines.push(...preview); return true; });
    expect(await undoLastOperation(ctx)).toBeNull();
    expect(lines.join(" ")).toContain("did not keep which keys");
    expect(notices.join(" ")).toContain("Undo stopped");
    expect(file.data.journal.entries).toHaveLength(1);
    expect(v.frontmatter.get("J/21.11 X.md")).toEqual({ tipo: "archivado", archivado: "2026-09-01" });
    await file.data.save();
    expect(file.stored().journalVersion).toBe(JOURNAL_VERSION);
    expect((file.stored().journal as Operation[])[0].effects).toEqual(legacy.effects);
  });

  it("keeps a step of an unknown kind in the journal and shows why", async () => {
    const v = fakeVault();
    const file = dataFile({ journal: [{ kind: "fix", label: "Future", at: "2026-10-01T00:00:00.000Z", effects: [{ kind: "teleported", path: "x" }] }] });
    await file.data.load();
    const lines: string[] = [];
    const { ctx, notices } = context(v.app, file.data, async (_title, preview) => { lines.push(...preview); return true; });
    expect(await undoLastOperation(ctx)).toBeNull();
    expect(lines.join(" ")).toContain('"teleported"');
    expect(notices.join(" ")).toContain("another version");
    expect(file.data.journal.entries[0].effects).toHaveLength(1);
  });

  it("keeps a journal from a newer version untouched and neither records nor undoes", async () => {
    const future = { jdexFolder: "J", journalVersion: JOURNAL_VERSION + 1, journal: [{ shape: "new" }], journalRemoved: ["z"] };
    const file = dataFile(future);
    const notices = await file.data.load();
    expect(notices.join(" ")).toContain("newer version");
    file.data.journal.begin("fix", "Ignored").push(created("a", "A"));
    await file.data.save();
    expect(file.stored().journal).toEqual([{ shape: "new" }]);
    expect(file.stored().journalVersion).toBe(JOURNAL_VERSION + 1);
    const { ctx } = context(fakeVault().app, file.data);
    expect(await undoLastOperation(ctx)).toBeNull();
  });
});

describe("Device identity", () => {
  it("is created once and kept in Obsidian local storage", () => {
    const local = new Map<string, unknown>();
    const host = { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => void local.set(key, value) };
    const first = deviceIdentity(host, () => "dev-1");
    expect(first).toBe("dev-1");
    expect(deviceIdentity(host, () => "dev-2")).toBe("dev-1");
    expect(deviceIdentity({}, () => "dev-3")).toBe("session-dev-3");
  });
});
