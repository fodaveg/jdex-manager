import { describe, expect, it, vi } from "vitest";
import { type App, type PluginManifest, TFile, TFolder, type TAbstractFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import type { IdEntry, JdIndex } from "../src/jd/index";
import { DEFAULT_SETTINGS } from "../src/settings";

vi.mock("../src/ui/confirm", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("../src/ui/go-to-id", async (original) => ({
  ...await original<Record<string, unknown>>(),
  IdSuggestModal: class {
    constructor(_app: App, readonly index: JdIndex, readonly pick: (entry: IdEntry) => void) {}
    setInstructions() {}
    open() { this.pick(this.index.ids.find((entry) => entry.system === "D02")!); }
  },
}));

describe("Obsidian system routing", () => {
  it("creates an ID folder in its own category before moving, despite earlier categories with the same number", async () => {
    const paths: TAbstractFile[] = [];
    for (const system of ["", "D01", "D02"]) {
      const prefix = system ? `${system}.` : "";
      for (const path of [`${prefix}20-29 Area`, `${prefix}20-29 Area/${prefix}21 Category`]) {
        paths.push(Object.assign(new TFolder(), { path, name: path.split("/").at(-1) }));
      }
      const name = `${prefix}21.11 Project.md`;
      paths.push(Object.assign(new TFile(), { path: `JDex/${name}`, name, extension: "md" }));
    }
    const file = Object.assign(new TFile(), { path: "Loose.md", name: "Loose.md", extension: "md", stat: { ctime: 0 } });
    paths.push(file);
    const createFolder = vi.fn(async (path: string) => { paths.push(Object.assign(new TFolder(), { path })); });
    const renameFile = vi.fn(async (file: TFile, path: string) => { file.path = path; });
    const app = {
      vault: { getAllLoadedFiles: () => paths, getAbstractFileByPath: (path: string) => paths.find((file) => file.path === path), createFolder },
      fileManager: { renameFile },
    } as unknown as App;
    const plugin = new JdexManagerPlugin(app, {} as PluginManifest);
    Object.assign(plugin, { app, settings: { ...DEFAULT_SETTINGS, jdexFolder: "JDex" }, saveData: vi.fn(async () => {}) });
    await plugin.moveToIdFlow(file);
    const target = "D02.20-29 Area/D02.21 Category/D02.21.11 Project";
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith(target);
    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(renameFile).toHaveBeenCalledWith(file, `${target}/Loose.md`);
  });
});
