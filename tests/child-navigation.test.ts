import { type App, type TAbstractFile, TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/settings";
import { openEntry } from "../src/ui/go-to-id";
import { scanVault } from "../src/vault/scan";

/** Live-vault paths and Obsidian file classes, with only the APIs these actions use. */
function fixture() {
  const parent = "20-29 Trabajo/21 Productos/21.22 JDex Manager";
  const folder = (path: string): TFolder => Object.assign(new TFolder(), { path, name: path.slice(path.lastIndexOf("/") + 1), children: [] as TAbstractFile[] });
  const note = (path: string): TFile => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1), extension: "md" });
  const childA = folder(`${parent}/+ A`);
  const childB = folder(`${parent}/+ B`);
  const noteA = note("JDex/21.22+ A #ayuda.md");
  const noteB = note("JDex/21.22+ B.md");
  const content = note(`${childA.path}/Detalle.md`);
  childA.children.push(content);
  const files = [folder("20-29 Trabajo"), folder("20-29 Trabajo/21 Productos"), folder(parent), childA, childB, noteA, noteB, content];
  let active: TFile = noteA;
  const openFile = vi.fn();
  const renameFile = vi.fn(async (file: TAbstractFile, path: string) => { file.path = path; });
  const app = {
    vault: { getAllLoadedFiles: () => files, getAbstractFileByPath: (path: string) => files.find((f) => f.path === path) ?? null },
    workspace: { getActiveFile: () => active, getLeaf: () => ({ openFile }) },
    fileManager: { renameFile },
  } as unknown as App;
  const settings = mergeSettings({ jdexFolder: "JDex", renamePairsWithoutAsking: true, liveHeaders: false });
  const plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as JdexManagerPlugin, { app, settings });
  return { app, settings, plugin, childA, childB, noteA, noteB, content, openFile, renameFile, setActive: (file: TFile) => { active = file; } };
}

describe("Obsidian child navigation and paired rename", () => {
  it("go to folder and toggle reach the child, then toggle its content back to the child note", async () => {
    const f = fixture();
    const child = scanVault(f.app, f.settings).ids.find((e) => e.notePath === f.noteA.path)!;
    expect(await openEntry(f.app, child, true)).toBeNull();
    expect(f.openFile).toHaveBeenLastCalledWith(f.content);
    await f.plugin.toggleNoteAndFolder();
    expect(f.openFile).toHaveBeenLastCalledWith(f.content);
    f.setActive(f.content);
    await f.plugin.toggleNoteAndFolder();
    expect(f.openFile).toHaveBeenLastCalledWith(f.noteA);
  });

  it("renaming A's note after the live vault changed renames A's folder and leaves B alone", async () => {
    const f = fixture();
    const oldPath = f.noteA.path;
    f.noteA.path = "JDex/21.22+ Z #ayuda.md";
    await f.plugin.onRename(f.noteA, oldPath);
    expect(f.renameFile).toHaveBeenCalledTimes(1);
    expect(f.renameFile).toHaveBeenCalledWith(f.childA, f.childA.path.replace("+ A", "+ Z"));
    expect(f.childB.path).toContain("/+ B");
    expect(f.noteB.path).toBe("JDex/21.22+ B.md");
  });
});
