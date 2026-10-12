// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026 (index coherence), findings 11 and 13, Obsidian: the «where» bar and
 * the ID panel follow the index, a deleted ID leaves its header list (e615938a); unloading
 * stops in-flight writes and closes the plugin's dialogs (0ebb2751).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type App, type Modal, type PluginManifest, TFile, TFolder, type TAbstractFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/jd/settings";
import type { Effect } from "../src/jd/journal";
import { IdPanelView } from "../src/ui/id-panel";
import { closeTrackedModals, trackedModalCount, trackModal } from "../src/ui/modal-registry";
import { maintainSystem } from "../src/vault/maintenance";

const confirms = vi.hoisted(() => ({ count: 0, answer: false }));
vi.mock("../src/ui/confirm", () => ({
  confirm: async () => {
    confirms.count += 1;
    return confirms.answer;
  },
}));

afterEach(() => {
  closeTrackedModals();
  vi.restoreAllMocks();
});

/** A loaded plugin over a tiny vault, capturing vault events and the status bar items. */
async function loaded() {
  const note = Object.assign(new TFile(), { path: "JDex/11.11 Note.md", name: "11.11 Note.md", basename: "11.11 Note", extension: "md" });
  const folder = Object.assign(new TFolder(), { path: "10-19 Area/11 Category/11.11 Note", name: "11.11 Note" });
  const paths: TAbstractFile[] = [note, folder];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const bars: { setText: ReturnType<typeof vi.fn> }[] = [];
  const app = {
    vault: {
      getAllLoadedFiles: () => paths,
      getAbstractFileByPath: (path: string) => paths.find((file) => file.path === path) ?? null,
      getFiles: () => paths.filter((p): p is TFile => p instanceof TFile),
      on: (name: string, callback: (...args: unknown[]) => unknown) => events.set(name, callback),
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { layoutReady: false, getActiveFile: () => note, on: vi.fn(), onLayoutReady: vi.fn() },
  } as unknown as App;
  const plugin = new JdexManagerPlugin(app, {} as PluginManifest);
  Object.assign(plugin, {
    app,
    loadData: async () => ({ jdexFolder: "JDex" }),
    addSettingTab: vi.fn(),
    addStatusBarItem: () => {
      const bar = { addClass: vi.fn(), setText: vi.fn() };
      bars.push(bar);
      return bar;
    },
    registerDomEvent: vi.fn(),
    registerEvent: vi.fn(),
    registerView: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEditorSuggest: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
    addCommand: vi.fn(),
  });
  await plugin.onload();
  return { plugin, note, folder, paths, events, whereBar: bars[2] };
}

describe("Obsidian: views follow the index (e615938a)", () => {
  it("renaming the active ID note updates the «where» bar after the index is invalidated", async () => {
    const { plugin, note, folder, events, whereBar } = await loaded();
    plugin.refreshWhere();
    expect(whereBar.setText).toHaveBeenLastCalledWith(expect.stringContaining("11.11 Note"));
    Object.assign(note, { path: "JDex/11.11 Renamed.md", name: "11.11 Renamed.md", basename: "11.11 Renamed" });
    Object.assign(folder, { path: "10-19 Area/11 Category/11.11 Renamed", name: "11.11 Renamed" });
    events.get("rename")!(note, "JDex/11.11 Note.md");
    expect(whereBar.setText).toHaveBeenLastCalledWith(expect.stringContaining("11.11 Renamed"));
  });

  it("deleting a JDex ID note refreshes its category header list", async () => {
    const { plugin, note } = await loaded();
    const refresh = vi.spyOn(plugin, "refreshHeaders").mockResolvedValue(undefined);
    await plugin.onDelete(note);
    expect(refresh).toHaveBeenCalledWith("11", false);
    refresh.mockClear();
    // Control: a file outside the JDex folder does not.
    await plugin.onDelete(Object.assign(new TFile(), { path: "Other/11.12 X.md", name: "11.12 X.md", extension: "md" }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the ID panel repaints on «index changed» and when its note's description is reparsed", async () => {
    const metadata = new Map<string, (file: { path: string }) => void>();
    let indexListener: () => void = () => {};
    const panel = Object.create(IdPanelView.prototype) as IdPanelView;
    Object.assign(panel, {
      app: { workspace: { on: vi.fn() }, metadataCache: { on: (name: string, callback: (file: { path: string }) => void) => metadata.set(name, callback) } },
      source: { index: vi.fn(), settings: () => ({ jdexFolder: "JDex" }), onIndexChanged: (listener: () => void) => { indexListener = listener; return () => {}; } },
      registerEvent: vi.fn(),
      register: vi.fn(),
    });
    const render = vi.spyOn(panel, "render").mockImplementation(() => {
      Object.assign(panel, { shownNotePath: "JDex/11.11 Note.md" });
    });
    await panel.onOpen();
    expect(render).toHaveBeenCalledTimes(1);
    indexListener();
    expect(render).toHaveBeenCalledTimes(2);
    metadata.get("changed")!({ path: "JDex/11.11 Note.md" });
    expect(render).toHaveBeenCalledTimes(3);
    metadata.get("changed")!({ path: "JDex/11.12 Other.md" });
    expect(render).toHaveBeenCalledTimes(3);
  });
});

describe("Obsidian: unloading stops writes and closes dialogs (0ebb2751)", () => {
  it("closes the dialogs it opened", () => {
    const close = vi.fn();
    const modal = { close, onClose: vi.fn() } as unknown as Modal;
    trackModal(modal);
    expect(trackedModalCount()).toBe(1);
    const plugin = Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin;
    plugin.onunload();
    expect(close).toHaveBeenCalled();
    expect(trackedModalCount()).toBe(0);
  });

  it("a maintenance pass stops before its next write once stopped", async () => {
    const fm = { descripcion: "x" } as Record<string, unknown>;
    const note = Object.assign(new TFile(), { path: "J/21.11 Note.md", name: "21.11 Note.md", basename: "21.11 Note", extension: "md", stat: { ctime: 1, mtime: 1 } });
    const processFrontMatter = vi.fn(async (_file: TFile, apply: (value: Record<string, unknown>) => void) => apply(fm));
    const app = {
      vault: { getAllLoadedFiles: () => [Object.assign(new TFolder(), { path: "J" }), note], getMarkdownFiles: () => [note], getAbstractFileByPath: (path: string) => (path === note.path ? note : null), cachedRead: async () => "# 21.11 Note\n", read: async () => "# 21.11 Note\n", process: vi.fn() },
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
      fileManager: { processFrontMatter },
    } as unknown as App;
    const settings = mergeSettings({ jdexFolder: "J", automaticMaintenance: true });
    const effects: Effect[] = [];
    await maintainSystem(app, settings, effects, undefined, () => true);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
    // Control: not stopped, it writes the derived fields.
    await maintainSystem(app, settings, effects, undefined, () => false);
    expect(processFrontMatter).toHaveBeenCalled();
  });

  it("after unload, automatic maintenance does not start and a pending rename does not write", async () => {
    const { plugin, note, events } = await loaded();
    plugin.onunload();
    const renamed = Object.assign(note, { path: "JDex/11.11 Otro.md", name: "11.11 Otro.md", basename: "11.11 Otro" });
    confirms.count = 0;
    confirms.answer = true;
    await (events.get("rename")!(renamed, "JDex/11.11 Note.md") as Promise<void> | undefined);
    await plugin.onRename(renamed, "JDex/11.11 Note.md");
    expect(confirms.count).toBe(0);
    plugin.settings.automaticMaintenance = true;
    await plugin.maintainAutomatically();
    expect((plugin as unknown as { maintenanceRunning: boolean }).maintenanceRunning).toBe(false);
  });
});
