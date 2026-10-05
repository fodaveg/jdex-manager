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
  let activeFile = file;
  const commands: Command[] = [];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const workspaceEvents = new Map<string, (...args: unknown[]) => unknown>();
  const search = vi.fn();
  const app = {
    internalPlugins: { getPluginById: () => ({ instance: { openGlobalSearch: search } }) },
    vault: {
      getAllLoadedFiles: () => paths,
      getAbstractFileByPath: (path: string) => paths.find((file) => file.path === path) ?? null,
      getFiles: () => paths.filter((p): p is TFile => p instanceof TFile),
      on: (name: string, callback: (...args: unknown[]) => unknown) => events.set(name, callback),
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: {
      layoutReady: false,
      getActiveFile: () => activeFile,
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
  return { plugin, file, folder, paths, events, workspaceEvents, commands, search, setActiveFile: (file: TFile) => { activeFile = file; } };
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
  it('selects active notes and folders by system and exact path when their ID repeats', async () => {
    const { plugin, paths, commands, setActiveFile } = await host();
    const entries = ['D01', 'D02', ''].map((system) => {
      const prefix = system ? `${system}.` : '';
      const label = `${prefix}11.11 Note`;
      return { id: '11.11', category: '11', title: 'Note', label, system, notePath: `JDex/${label}.md`, folderPath: `${prefix}10-19 Area/${prefix}11 Category/${label}` };
    });
    vi.spyOn(plugin, 'cachedIndex').mockReturnValue({ ...plugin.cachedIndex(), ids: entries });
    const retire = vi.spyOn(plugin, 'retireFlow').mockResolvedValue();
    const child = vi.spyOn(plugin, 'createChildFlow').mockResolvedValue();
    for (const entry of entries) {
      const note = Object.assign(new TFile(), { path: entry.notePath, name: `${entry.label}.md`, basename: entry.label, extension: 'md' });
      const folder = Object.assign(new TFolder(), { path: entry.folderPath, name: entry.label });
      paths.push(note, folder);
      setActiveFile(note);
      expect(plugin.entryFor(note)).toBe(entry);
      expect(plugin.entryFor(folder)).toBe(entry);
      expect(plugin.activeIdEntry()).toBe(entry);
      for (const id of ['retire-id', 'create-child']) {
        const command = commands.find((command) => command.id === id)!;
        expect(command.checkCallback!(true)).toBe(true);
        expect(command.checkCallback!(false)).toBe(true);
      }
      expect(retire).toHaveBeenLastCalledWith(entry);
      expect(child).toHaveBeenLastCalledWith(entry);
    }
    expect(plugin.entryFor(Object.assign(new TFile(), { name: 'D02.11.11 Note.md', path: 'Elsewhere/D02.11.11 Note.md' }))).toBeNull();
    expect(plugin.entryFor(Object.assign(new TFile(), { name: 'D02.11.11+ Child.md', path: 'JDex/D02.11.11+ Child.md' }))).toBeNull();
  });

  it("searches the active category in its own system when category numbers repeat", async () => {
    const { plugin, commands, search, setActiveFile } = await host();
    const categories = ["D01", "D02", ""].map((system) => {
      const prefix = system ? `${system}.` : "";
      return { system, number: "21", areaNumber: 20, title: "Category", label: `${prefix}21 Category`, path: `${prefix}20-29 Area/${prefix}21 Category` };
    });
    vi.spyOn(plugin, "cachedIndex").mockReturnValue({ ...plugin.cachedIndex(), categories });
    const command = commands.find((entry) => entry.id === "search-in-category")!;
    for (const category of categories) {
      setActiveFile(Object.assign(new TFile(), { path: `${category.path}/note.md` }));
      expect(command.checkCallback!(true)).toBe(true);
      expect(command.checkCallback!(false)).toBe(true);
      expect(search).toHaveBeenLastCalledWith(`path:"${category.path}/"`);
    }
  });

});
