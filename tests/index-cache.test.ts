import { afterEach, describe, expect, it, vi } from "vitest";
import { type Command, type PluginManifest, TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import * as engine from "../src/jd/index";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

afterEach(() => vi.restoreAllMocks());

/** Minimal host captures real command and event registrations without opening UI. */
async function host() {
  const jdex = "JDex";
  const v = new FakeObsidianVault();
  const file = v.file("JDex/11.11 Note.md");
  const folder = v.folder("10-19 Area/11 Category/11.11 Note");
  v.setActiveFile(file);
  v.setLayoutReady(false); // `onLayoutReady` callbacks stay queued: the test never opens a real layout
  const commands: Command[] = [];
  const { app } = v;
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
  return { plugin, v, file, folder, commands };
}

describe("Obsidian in-memory index", () => {
  it("palette checks, right-click and file-open reuse a valid index beyond the old TTL", async () => {
    const { plugin, file, v, commands } = await host();
    const build = vi.spyOn(engine, "buildIndex");
    const index = plugin.cachedIndex();
    build.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    for (const command of commands) command.checkCallback?.(true);
    v.emitWorkspace("file-menu", { addItem: vi.fn() }, file);
    v.emitWorkspace("file-open", file);
    expect(plugin.cachedIndex()).toBe(index);
    expect(build).not.toHaveBeenCalled();
  });

  it.each(["create", "delete", "rename"])("%s invalidates before event consumers read the index", async (event) => {
    const { plugin, file, v } = await host();
    vi.spyOn(plugin, "onCreate").mockResolvedValue();
    vi.spyOn(plugin, "onRename").mockResolvedValue();
    const before = plugin.cachedIndex();
    v.emit(event as "create", file, "old.md");
    expect(plugin.cachedIndex()).not.toBe(before);
  });

  it("modify never invalidates the index: it is built from paths, not from contents", async () => {
    const { plugin, file, folder, v } = await host();
    const before = plugin.cachedIndex();
    for (const changed of [folder, v.file("JDex/a.pdf"), v.file("Other/note.md"), v.file("JDex/sub/note.md"), file]) {
      v.emit("modify", changed);
      expect(plugin.cachedIndex()).toBe(before);
    }
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
    const { plugin, v, commands } = await host();
    const entries = ['D01', 'D02', ''].map((system) => {
      const prefix = system ? `${system}.` : '';
      const label = `${prefix}11.11 Note`;
      return { id: '11.11', category: '11', title: 'Note', label, system, notePath: `JDex/${label}.md`, folderPath: `${prefix}10-19 Area/${prefix}11 Category/${label}` };
    });
    vi.spyOn(plugin, 'cachedIndex').mockReturnValue({ ...plugin.cachedIndex(), ids: entries });
    const retire = vi.spyOn(plugin, 'retireFlow').mockResolvedValue();
    const child = vi.spyOn(plugin, 'createChildFlow').mockResolvedValue();
    for (const entry of entries) {
      // The unprefixed entry is the file and folder `host()` already created.
      const note = (v.app.vault.getAbstractFileByPath(entry.notePath) as TFile | null) ?? v.file(entry.notePath);
      const folder = v.app.vault.getAbstractFileByPath(entry.folderPath) ?? v.folder(entry.folderPath);
      v.setActiveFile(note);
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
    const { plugin, commands, v } = await host();
    const categories = ["D01", "D02", ""].map((system) => {
      const prefix = system ? `${system}.` : "";
      return { system, number: "21", areaNumber: 20, title: "Category", label: `${prefix}21 Category`, path: `${prefix}20-29 Area/${prefix}21 Category` };
    });
    vi.spyOn(plugin, "cachedIndex").mockReturnValue({ ...plugin.cachedIndex(), categories });
    const command = commands.find((entry) => entry.id === "search-in-category")!;
    for (const category of categories) {
      v.setActiveFile(v.file(`${category.path}/note.md`));
      expect(command.checkCallback!(true)).toBe(true);
      expect(command.checkCallback!(false)).toBe(true);
      expect(v.searches.at(-1)).toBe(`path:"${category.path}/"`);
    }
  });

});
