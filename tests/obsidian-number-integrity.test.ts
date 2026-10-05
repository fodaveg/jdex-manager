// @vitest-environment happy-dom
/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- DOM fixtures have no Obsidian globals. */
import { describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { buildIndex } from "../src/jd/index";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createId, CreateIdModal } from "../src/ui/create-id";
import { CreateChildModal, CreateHeaderModal } from "../src/ui/create-structure";
import { createJdexNote } from "../src/vault/create";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Modal: class {
    contentEl = document.createElement("div");
    constructor(readonly app: App) {}
    close() {}
  },
  Notice: class { constructor(message: string) { notices.push(message); } },
}));

const settings = { ...DEFAULT_SETTINGS, jdexFolder: "JDex" };
const file = (name: string) => Object.assign(new TFile(), { path: `JDex/${name}.md`, name: `${name}.md`, extension: "md" });
function fixture() {
  const files = [file("21 Category"), file("21.11 Parent")];
  const create = vi.fn(async (path: string, content: string) => Object.assign(new TFile(), { path, content }));
  const app = { vault: { getAllLoadedFiles: () => files, getAbstractFileByPath: (path: string) => files.find((f) => f.path === path), create }, workspace: { getLeaf: () => ({ openFile: vi.fn() }) } } as unknown as App;
  const index = buildIndex({ systemRoot: "", jdexFolder: "JDex", folderPaths: [], notePaths: files.map((f) => f.path) });
  return { app, files, create, index, category: index.categories[0], parent: index.ids[0] };
}

describe("Obsidian live number validation", () => {
  it("rejects an ID occupied under another title after opening the dialog and proposes the next", async () => {
    const f = fixture();
    const onSubmit = vi.fn(async () => {});
    const modal = new CreateIdModal(f.app, f.index, f.category, settings, onSubmit);
    Object.assign(modal, { title: "Mine" });
    const input = document.createElement("input"); input.className = "jdex-id-input";
    modal.contentEl.append(input);
    f.files.push(file("21.12 Somebody else"));
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("21.13");
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: "21.13" }));
  });

  it("keeps a conflicting header dialog open and proposes another X0", async () => {
    const f = fixture();
    const modal = new CreateHeaderModal(f.app, f.index, f.category, settings, async () => {});
    Object.assign(modal, { title: "Header" });
    const input = document.createElement("input"); modal.contentEl.append(input);
    f.files.push(file("21.10 Another header"));
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(f.create).not.toHaveBeenCalled();
    expect(input.value).toBe("21.20");
  });

  it("rejects only the same child title on a fresh index", async () => {
    const f = fixture();
    const modal = new CreateChildModal(f.app, f.index, f.parent, settings, async () => {});
    Object.assign(modal, { title: "Child" });
    f.files.push(file("21.11+ Child #tag"));
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(f.create).not.toHaveBeenCalled();
    await expect(createJdexNote(f.app, settings, "id", "21.11+ Child", {})).rejects.toThrow(/already used/i);
    await createJdexNote(f.app, settings, "id", "21.11+ Another child", {});
    expect(f.create).toHaveBeenCalledOnce();
  });

  it("the write boundary also rejects stale ID/header snapshots with any title", async () => {
    const f = fixture();
    f.files.push(file("21.12 Another title"), file("21.10 Different header"));
    await expect(createId(f.app, settings, f.index, f.category, { id: "21.12", title: "Mine", createFolder: false, createPattern: false })).rejects.toThrow(/already used/i);
    await expect(createJdexNote(f.app, settings, "cabecera", "21.10 ■ Mine", {})).rejects.toThrow(/already used/i);
    expect(f.create).not.toHaveBeenCalled();
    await createId(f.app, settings, f.index, f.category, { id: "21.13", title: "Free", createFolder: false, createPattern: false });
    expect(f.create).toHaveBeenCalledOnce();
  });

  it("reports removal of the number and journals the rename for undo", async () => {
    const f = fixture();
    const saveData = vi.fn(async () => {});
    const plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, { app: f.app, settings, journal: [], saveData }) as unknown as JdexManagerPlugin;
    const renamed = file("Parent");
    await plugin.onRename(renamed, "JDex/21.11 Parent.md");
    expect(notices.at(-1)).toBe("«21.11» ha perdido su número: un ID nunca se renumera (johnnydecimal.com). Deshacer.");
    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ journal: [expect.objectContaining({ effects: [{ kind: "moved", from: "JDex/21.11 Parent.md", to: "JDex/Parent.md" }] })] }));
  });
});
