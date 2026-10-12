// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TAbstractFile, TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import type { Effect } from "../src/jd/journal";
import { mergeSettings } from "../src/settings";
import { MaintenanceGate, onceNotifier } from "../src/vault/maintenance-gate";
import { maintainSystem } from "../src/vault/maintenance";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Notice: class { constructor(message: string) { notices.push(message); } },
}));
vi.mock("../src/vault/maintenance", () => ({ maintainSystem: vi.fn() }));

const file = (path: string): TFile => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1), extension: "md" });
type Private = { queueMaintenance(file: TAbstractFile, oldPath?: string): void };

describe("automatic maintenance queue", () => {
  let v: FakeObsidianVault;
  const run = vi.mocked(maintainSystem);
  let plugin: JdexManagerPlugin;

  beforeEach(() => {
    vi.useFakeTimers();
    // eslint-disable-next-line obsidianmd/prefer-active-window-timers -- this IS the activeWindow stub.
    vi.stubGlobal("activeWindow", { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (id: number) => clearTimeout(id) });
    v = new FakeObsidianVault();
    run.mockReset();
    const { app } = v;
    plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin, {
      app,
      settings: mergeSettings({ jdexFolder: "J", systemRoot: "Sys", automaticMaintenance: true }),
      loadData: async () => null,
      saveData: vi.fn(async () => {}),
      maintenanceGate: new MaintenanceGate(),
      maintenanceRunning: false,
      maintenanceTimer: null,
      maintenanceWarn: vi.fn(),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const queue = (path: string, oldPath?: string) => (plugin as unknown as Private).queueMaintenance(file(path), oldPath);
  const rewrite = (path: string, after: string): Effect => ({ kind: "note-rewrite", path, before: "old", after });

  it("the pass's own writes (path and content) do not provoke another pass", async () => {
    run.mockImplementationOnce(async (_app, _settings, effects) => {
      v.file("J/00.00 Index.md", "new");
      effects.push(rewrite("J/00.00 Index.md", "new"));
      queue("J/00.00 Index.md");
    });
    queue("J/21.11 Note.md");
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a foreign event during the pass provokes exactly one more pass", async () => {
    run.mockImplementationOnce(async () => queue("J/21.12 Other.md"));
    queue("J/21.11 Note.md");
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("an edit of a note the pass wrote, with other content, counts as foreign; an unrelated path does not", async () => {
    run.mockImplementationOnce(async (_app, _settings, effects) => {
      v.file("J/00.00 Index.md", "edited by someone else");
      effects.push(rewrite("J/00.00 Index.md", "new"));
      queue("J/00.00 Index.md");
    });
    queue("J/21.11 Note.md");
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);

    run.mockReset();
    run.mockImplementationOnce(async () => queue("Elsewhere/x.md"));
    queue("J/21.11 Note.md");
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("three passes over an index note without markers warn at most once", async () => {
    const warn = vi.fn();
    const once = onceNotifier(warn);
    for (let i = 0; i < 3; i++) once("00.00 has no <!-- jdex:indice --> markers.");
    once("another problem");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("paired renames", () => {
  it("a foreign rename during the pair's own rename still gets its warning; the plugin's own rename is ignored", async () => {
    notices.length = 0;
    const v = new FakeObsidianVault();
    const parent = "20-29 Trabajo/21 Productos/21.22 JDex Manager";
    const childA = v.folder(`${parent}/+ A`);
    const noteA = v.file("JDex/21.22+ A #ayuda.md");
    v.setActiveFile(noteA);
    const { app } = v;
    const { renameFile } = app.fileManager;
    let plugin: JdexManagerPlugin;
    // The app tells the plugin about every rename, its own folder rename included; someone else
    // renames a note at the same time as the pair's folder.
    v.app.vault.on("rename", (f, old) => Promise.all([
      plugin.onRename(f, old),
      f === childA ? plugin.onRename(v.file("JDex/Parent.md"), "JDex/21.11 Parent.md") : undefined,
    ]));
    plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin, {
      app,
      settings: mergeSettings({ jdexFolder: "JDex", renamePairsWithoutAsking: true, liveHeaders: false }),
      loadData: async () => null,
      saveData: vi.fn(async () => {}),
      refreshInboxCount: vi.fn(),
    });
    await renameFile(noteA, "JDex/21.22+ Z #ayuda.md");
    await v.settle();
    expect(vi.mocked(renameFile).mock.calls.filter(([node]) => node === childA)).toHaveLength(1);
    expect(notices.some((n) => n.includes("«21.11» ha perdido su número"))).toBe(true);
  });
});
