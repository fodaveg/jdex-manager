import { afterEach, describe, expect, it, vi } from "vitest";
import { type App, type Command, type PluginManifest, TFile, TFolder, type TAbstractFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import * as engine from "../src/jd/index";

afterEach(() => vi.restoreAllMocks());

/** Minimal host captures real command and event registrations without opening UI. */
async function host() {
  const jdex = "JDex";
  const file = Object.assign(new TFile(), { path: "JDex/11.11 Note.md", name: "11.11 Note.md", basename: "11.11 Note", extension: "md" });
  const folder = Object.assign(new TFolder(), { path: "10-19 Area/11 Category/11.11 Note", name: "11.11 Note" });
  const paths: TAbstractFile[] = [file, folder];
  const commands: Command[] = [];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const workspaceEvents = new Map<string, (...args: unknown[]) => unknown>();
  const app = {
    vault: {
      getAllLoadedFiles: () => paths,
      getFiles: () => paths.filter((p): p is TFile => p instanceof TFile),
      on: (name: string, callback: (...args: unknown[]) => unknown) => events.set(name, callback),
    },
    workspace: {
      layoutReady: false,
      getActiveFile: () => file,
      on: (name: string, callback: (...args: unknown[]) => unknown) => workspaceEvents.set(name, callback),
      onLayoutReady: vi.fn(),
    },
  } as unknown as App;
  const plugin = new JdexManagerPlugin(app, {} as PluginManifest);
  Object.assign(plugin, {
    app,
    loadData: async () => ({ jdexFolder: jdex }),
    addSettingTab: vi.fn(),
    addStatusBarItem: () => ({ addClass: vi.fn(), setText: vi.fn() }),
    registerDomEvent: vi.fn(),
    registerEvent: vi.fn(),
    registerView: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEditorSuggest: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
    addCommand: (command: Command) => commands.push(command),
  });
  await plugin.onload();
  return { plugin, file, folder, events, workspaceEvents, commands };
}

describe("Obsidian in-memory index", () => {
  it("palette checks, right-click and file-open reuse a valid index beyond the old TTL", async () => {
    const { plugin, file, workspaceEvents, commands } = await host();
    const build = vi.spyOn(engine, "buildIndex");
    const index = plugin.cachedIndex();
    build.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    for (const command of commands) command.checkCallback?.(true);
    workspaceEvents.get("file-menu")?.({ addItem: vi.fn() }, file);
    workspaceEvents.get("file-open")?.(file);
    expect(plugin.cachedIndex()).toBe(index);
    expect(build).not.toHaveBeenCalled();
  });

  it.each(["create", "delete", "rename"])("%s invalidates before event consumers read the index", async (event) => {
    const { plugin, file, events } = await host();
    vi.spyOn(plugin, "onCreate").mockResolvedValue();
    vi.spyOn(plugin, "onRename").mockResolvedValue();
    const before = plugin.cachedIndex();
    events.get(event)?.(file, "old.md");
    expect(plugin.cachedIndex()).not.toBe(before);
  });

  it("modify only invalidates direct JDex Markdown notes", async () => {
    const { plugin, file, folder, events } = await host();
    const before = plugin.cachedIndex();
    for (const changed of [folder, { path: "JDex/a.pdf", extension: "pdf" }, { path: "Other/note.md", extension: "md" }, { path: "JDex/sub/note.md", extension: "md" }]) {
      const item = changed === folder ? folder : Object.assign(new TFile(), changed);
      events.get("modify")?.(item);
      expect(plugin.cachedIndex()).toBe(before);
    }
    events.get("modify")?.(file);
    expect(plugin.cachedIndex()).not.toBe(before);
  });

  it("root settings changes select a fresh index", async () => {
    const { plugin } = await host();
    const before = plugin.cachedIndex();
    plugin.settings.systemRoot = "Other";
    const changed = plugin.cachedIndex();
    expect(changed).not.toBe(before);
    plugin.settings.jdexFolder = "New JDex";
    expect(plugin.cachedIndex()).not.toBe(changed);
  });
});
