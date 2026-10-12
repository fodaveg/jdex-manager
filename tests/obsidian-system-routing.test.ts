/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { describe, expect, it, vi } from "vitest";
import { type App, type PluginManifest } from "obsidian";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
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
    const v = new FakeObsidianVault();
    for (const system of ["", "D01", "D02"]) {
      const prefix = system ? `${system}.` : "";
      v.folder(`${prefix}20-29 Area/${prefix}21 Category`);
      v.file(`JDex/${prefix}21.11 Project.md`);
    }
    const file = v.file("Loose.md", "", undefined, 0);
    const { app } = v;
    const { createFolder } = app.vault;
    const { renameFile } = app.fileManager;
    const plugin = new JdexManagerPlugin(app, {} as PluginManifest);
    Object.assign(plugin, { app, settings: { ...DEFAULT_SETTINGS, jdexFolder: "JDex" }, saveData: vi.fn(async () => {}) });
    await plugin.moveToIdFlow(file);
    const target = "D02.20-29 Area/D02.21 Category/D02.21.11 Project";
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith(target);
    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(renameFile).toHaveBeenCalledWith(file, `${target}/Loose.md`);
    // The double really moved it: the folder tree and the old path agree.
    expect(v.exists(`${target}/Loose.md`)).toBe(true);
    expect(v.exists("Loose.md")).toBe(false);
  });
});
