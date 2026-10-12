// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, type TAbstractFile, TFile, TFolder } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { DEBUG_LOG_MAX_LINES, DEBUG_LOG_TITLE } from "../src/jd/public";
import { mergeSettings } from "../src/settings";
import { MaintenanceGate } from "../src/vault/maintenance-gate";
import { maintainSystem } from "../src/vault/maintenance";
import { DebugLogWriter, debugLogPath, isDebugLogPath } from "../src/vault/debug-log";

vi.mock("../src/vault/maintenance", () => ({ maintainSystem: vi.fn() }));

const FOLDER = "Sys/00 Sistema/00.02 Informes";
const PATH = `${FOLDER}/${DEBUG_LOG_TITLE}.md`;

function memoryVault() {
  const notes = new Map<string, string>();
  const folders = new Set<string>();
  const fileAt = (path: string) => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1), extension: "md" });
  const calls = { process: 0, create: 0 };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (notes.has(path) ? fileAt(path) : folders.has(path) ? Object.assign(new TFolder(), { path }) : null),
      process: async (file: TFile, update: (current: string) => string) => {
        calls.process += 1;
        notes.set(file.path, update(notes.get(file.path)!));
      },
      create: async (path: string, content: string) => {
        calls.create += 1;
        if (notes.has(path)) throw new Error("exists");
        notes.set(path, content);
        return fileAt(path);
      },
      createFolder: async (path: string) => { folders.add(path); },
      modify: async () => { throw new Error("the debug log must write with vault.process"); },
    },
  } as unknown as App;
  return { app, notes, calls };
}

const on = { debugLog: true, reportsFolder: FOLDER };

describe("Obsidian debug log writer", () => {
  it("writes nothing while the setting is off or there is no reports folder", async () => {
    const { app, notes } = memoryVault();
    const writer = new DebugLogWriter(app);
    await writer.record({ debugLog: false, reportsFolder: FOLDER }, "audit", new Error("x"));
    await writer.record({ debugLog: true, reportsFolder: "" }, "audit", new Error("x"));
    expect(notes.size).toBe(0);
  });

  it("creates the note once and appends the next errors with vault.process, in order", async () => {
    const { app, notes, calls } = memoryVault();
    const writer = new DebugLogWriter(app);
    void writer.record(on, "first", new RangeError("a"), "J/21.11 A.md");
    void writer.record(on, "second", new Error("b"));
    await writer.record(on, "third", new Error("c"));
    const lines = notes.get(PATH)!.split("\n").filter((line) => line.startsWith("- 20"));
    expect(lines.map((line) => line.split(" | ")[1])).toEqual(["first", "second", "third"]);
    expect(calls).toEqual({ create: 1, process: 2 });
  });

  it("does not lose a manual edit made to the note, and trims to 200 lines", async () => {
    const { app, notes } = memoryVault();
    const writer = new DebugLogWriter(app);
    await writer.record(on, "seed", new Error("a"));
    notes.set(PATH, notes.get(PATH)!.replace("Puedes borrar", "Mi comentario. Puedes borrar"));
    for (let i = 0; i < DEBUG_LOG_MAX_LINES + 10; i += 1) await writer.record(on, `w${i}`, new Error("e"));
    const body = notes.get(PATH)!;
    expect(body).toContain("Mi comentario.");
    expect(body.split("\n").filter((line) => line.startsWith("- 20"))).toHaveLength(DEBUG_LOG_MAX_LINES);
  });

  it("never rejects when the vault fails, and a created-meanwhile note is appended to", async () => {
    const { app, notes } = memoryVault();
    const failing = { vault: { ...app.vault, getAbstractFileByPath: () => { throw new Error("boom"); } } } as unknown as App;
    await expect(new DebugLogWriter(failing).record(on, "x", new Error("e"))).resolves.toBeUndefined();
    const raced = new DebugLogWriter(app);
    const original = app.vault.create.bind(app.vault);
    vi.spyOn(app.vault, "create").mockImplementationOnce(async (path, content) => {
      notes.set(path, "# Registro de depuración JDex\n\n<!-- jdex:registro -->\n- earlier\n");
      return original(path, content);
    });
    await raced.record(on, "after", new Error("e"));
    expect(notes.get(PATH)).toContain("- earlier");
    expect(notes.get(PATH)).toContain("| after |");
  });

  it("knows its own path", () => {
    expect(debugLogPath({ reportsFolder: "" })).toBeNull();
    expect(debugLogPath({ reportsFolder: FOLDER })).toBe(PATH);
    expect(isDebugLogPath({ reportsFolder: FOLDER }, PATH)).toBe(true);
    expect(isDebugLogPath({ reportsFolder: FOLDER }, `${FOLDER}/otra.md`)).toBe(false);
    expect(isDebugLogPath({ reportsFolder: "" }, "x.md")).toBe(false);
  });
});

describe("the debug log note does not start automatic maintenance", () => {
  const run = vi.mocked(maintainSystem);
  type Private = { queueMaintenance(file: TAbstractFile, oldPath?: string): void };
  let plugin: JdexManagerPlugin;
  const file = (path: string): TFile => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1), extension: "md" });

  beforeEach(() => {
    vi.useFakeTimers();
    // eslint-disable-next-line obsidianmd/prefer-active-window-timers -- this IS the activeWindow stub.
    vi.stubGlobal("activeWindow", { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (id: number) => clearTimeout(id) });
    run.mockReset();
    plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin, {
      app: { workspace: { layoutReady: true } },
      settings: mergeSettings({ jdexFolder: "Sys/00 Sistema/00.00 JDex", systemRoot: "Sys", reportsFolder: FOLDER, automaticMaintenance: true }),
      journal: [],
      saveData: vi.fn(async () => {}),
      maintenanceGate: new MaintenanceGate(),
      maintenanceRunning: false,
      maintenanceTimer: null,
      maintenanceWarn: vi.fn(),
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const queue = (path: string, oldPath?: string) => (plugin as unknown as Private).queueMaintenance(file(path), oldPath);

  it("a modify of the log note is ignored; the control, another report, starts a pass", async () => {
    queue(PATH);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
    queue(`${FOLDER}/Auditoría JD - 2026-10-12.md`);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("logError feeds the writer only when the setting is on", async () => {
    const record = vi.fn(async () => {});
    Object.assign(plugin, { debugWriter: { record } });
    plugin.logError("audit", new Error("e"), "p");
    expect(record).toHaveBeenCalledWith(plugin.settings, "audit", expect.any(Error), "p");
  });
});
