/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { type TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/settings";
import { openEntry } from "../src/ui/go-to-id";
import { scanVault } from "../src/vault/scan";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

/** The shared vault double with the folder tree and notes these actions use. */
function fixture() {
  const parent = "20-29 Trabajo/21 Productos/21.22 JDex Manager";
  const v = new FakeObsidianVault();
  const childA = v.folder(`${parent}/+ A`);
  const childB = v.folder(`${parent}/+ B`);
  const noteA = v.file("JDex/21.22+ A #ayuda.md");
  const noteB = v.file("JDex/21.22+ B.md");
  const content = v.file(`${childA.path}/Detalle.md`);
  v.setActiveFile(noteA);
  const { app } = v;
  const settings = mergeSettings({ jdexFolder: "JDex", renamePairsWithoutAsking: true, liveHeaders: false });
  const plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin, { app, settings });
  return { v, app, settings, plugin, childA, childB, noteA, noteB, content, renameFile: app.fileManager.renameFile, setActive: (file: TFile) => v.setActiveFile(file) };
}

describe("Obsidian child navigation and paired rename", () => {
  it("go to folder and toggle reach the child, then toggle its content back to the child note", async () => {
    const f = fixture();
    const child = scanVault(f.app, f.settings).ids.find((e) => e.notePath === f.noteA.path)!;
    expect(await openEntry(f.app, child, true)).toBeNull();
    expect(f.v.opened.at(-1)).toBe(f.content);
    await f.plugin.toggleNoteAndFolder();
    expect(f.v.opened.at(-1)).toBe(f.content);
    f.setActive(f.content);
    await f.plugin.toggleNoteAndFolder();
    expect(f.v.opened.at(-1)).toBe(f.noteA);
  });

  it("renaming A's note after the live vault changed renames A's folder and leaves B alone", async () => {
    const f = fixture();
    const oldPath = f.noteA.path;
    // The user renames the note in the app; the plugin then reacts to the rename event.
    await f.renameFile(f.noteA, "JDex/21.22+ Z #ayuda.md");
    vi.mocked(f.renameFile).mockClear();
    const childAPath = f.childA.path;
    await f.plugin.onRename(f.noteA, oldPath);
    expect(f.renameFile).toHaveBeenCalledTimes(1);
    expect(f.renameFile).toHaveBeenCalledWith(f.childA, childAPath.replace("+ A", "+ Z"));
    expect(f.v.exists(childAPath.replace("+ A", "+ Z") + "/Detalle.md")).toBe(true);
    expect(f.childB.path).toContain("/+ B");
    expect(f.noteB.path).toBe("JDex/21.22+ B.md");
  });
});
