// @vitest-environment happy-dom
/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- DOM fixtures have no Obsidian globals. */
/**
 * Audit 12 Oct 2026, finding 6 (Obsidian): Create category and Create area re-read the
 * vault at confirm time and reject a number taken under another title.
 */
import { describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import { buildIndex, selectCreationSystem } from "../src/jd/index";
import { DEFAULT_SETTINGS } from "../src/settings";
import { CreateAreaModal, CreateCategoryModal } from "../src/ui/create-structure";
import { createJdexNote } from "../src/vault/create";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Modal: class {
    contentEl = document.createElement("div");
    constructor(readonly app: App) {}
    close() {}
  },
  Notice: class { constructor(_message: string) {} },
}));

const settings = { ...DEFAULT_SETTINGS, jdexFolder: "JDex" };
const file = (name: string) => Object.assign(new TFile(), { path: `JDex/${name}.md`, name: `${name}.md`, basename: name, extension: "md" });

function fixture() {
  const files = [file("20-29 Productos"), file("21 Software"), file("21.11 Algo")];
  const create = vi.fn(async (path: string, content: string) => {
    const created = Object.assign(new TFile(), { path, content, name: path.slice(path.lastIndexOf("/") + 1), extension: "md" });
    files.push(created);
    return created;
  });
  const app = {
    vault: { getAllLoadedFiles: () => files, getAbstractFileByPath: (path: string) => files.find((f) => f.path === path), create },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }) },
  } as unknown as App;
  const index = selectCreationSystem(buildIndex({ systemRoot: "", jdexFolder: "JDex", folderPaths: [], notePaths: files.map((f) => f.path) }), "");
  return { app, files, create, index, area: index.areas.find((a) => a.number === 20)! };
}

type Submittable = { submit(): Promise<void> };
const created = (f: ReturnType<typeof fixture>) => f.create.mock.calls.map(([path]) => path);

describe("Obsidian: create category and area revalidate at confirm (8cb1a450)", () => {
  it("category: rejects a number taken under another title after opening and proposes the next", async () => {
    const f = fixture();
    const modal = new CreateCategoryModal(f.app, f.index, f.area, settings, async () => {});
    Object.assign(modal, { title: "Mine" });
    Object.assign(modal, { toggles: { folder: false, inbox: true, archive: true } });
    const input = document.createElement("input"); modal.contentEl.append(input);
    expect((modal as unknown as { number: string }).number).toBe("22");
    f.files.push(file("22 Another device"));
    await (modal as unknown as Submittable).submit();
    expect(f.create).not.toHaveBeenCalled();
    expect(input.value).toBe("23");
    await (modal as unknown as Submittable).submit();
    expect(created(f)).toContain("JDex/23 Mine.md");
  });

  it("category: the .01/.09 check uses the re-read index", async () => {
    const f = fixture();
    const modal = new CreateCategoryModal(f.app, f.index, f.area, settings, async () => {});
    Object.assign(modal, { title: "Mine" });
    Object.assign(modal, { toggles: { folder: false, inbox: true, archive: true } });
    // Another device already created the inbox of 22 (but not the category note).
    f.files.push(file("22.01 Inbox de otro"));
    await (modal as unknown as Submittable).submit();
    expect(created(f)).toContain("JDex/22 Mine.md");
    expect(created(f).some((path) => path.startsWith("JDex/22.01"))).toBe(false);
    expect(created(f).some((path) => path.startsWith("JDex/22.09"))).toBe(true);
  });

  it("category control: without a conflict the first confirm creates it", async () => {
    const f = fixture();
    const modal = new CreateCategoryModal(f.app, f.index, f.area, settings, async () => {});
    Object.assign(modal, { title: "Mine" });
    Object.assign(modal, { toggles: { folder: false, inbox: false, archive: false } });
    await (modal as unknown as Submittable).submit();
    expect(created(f)).toEqual(["JDex/22 Mine.md"]);
  });

  it("area: rejects a number taken under another title after opening and proposes the next", async () => {
    const f = fixture();
    const modal = new CreateAreaModal(f.app, f.index, settings, async () => {});
    Object.assign(modal, { title: "Mine" });
    Object.assign(modal, { toggles: { folder: false, management: false } });
    const input = document.createElement("input"); modal.contentEl.append(input);
    expect((modal as unknown as { number: string }).number).toBe("10-19");
    f.files.push(file("10-19 Another device"));
    await (modal as unknown as Submittable).submit();
    expect(f.create).not.toHaveBeenCalled();
    expect(input.value).toBe("30-39");
    await (modal as unknown as Submittable).submit();
    expect(created(f)).toEqual(["JDex/30-39 Mine.md"]);
  });

  it("area control: without a conflict the first confirm creates it", async () => {
    const f = fixture();
    const modal = new CreateAreaModal(f.app, f.index, settings, async () => {});
    Object.assign(modal, { title: "Mine" });
    Object.assign(modal, { toggles: { folder: false, management: false } });
    await (modal as unknown as Submittable).submit();
    expect(created(f)).toEqual(["JDex/10-19 Mine.md"]);
  });

  it("the write boundary rejects category and area numbers taken under another title", async () => {
    const f = fixture();
    await expect(createJdexNote(f.app, settings, "categoria", "21 Other title", {})).rejects.toThrow(/already used/i);
    await expect(createJdexNote(f.app, settings, "area", "20-29 Other title", {})).rejects.toThrow(/already used/i);
    expect(f.create).not.toHaveBeenCalled();
    await createJdexNote(f.app, settings, "categoria", "22 Free", {});
    expect(f.create).toHaveBeenCalledOnce();
  });
});
