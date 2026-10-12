/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- the test inspects the double's own tree, which is always what it says. */
import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

describe("FakeObsidianVault: folder tree", () => {
  it("keeps parent and children coherent on create, rename and trash", async () => {
    const v = new FakeObsidianVault();
    const a = v.folder("A/B");
    const file = v.file("A/B/x.md", "x");
    expect(a.parent).toBe(v.app.vault.getAbstractFileByPath("A"));
    expect(a.children).toEqual([file]);
    expect(v.root.children.map((child) => child.path)).toEqual(["A"]);

    await v.app.fileManager.renameFile(a, "A/C");
    expect(a.path).toBe("A/C");
    expect(file.path).toBe("A/C/x.md");
    expect(file.parent).toBe(a);
    expect(v.app.vault.getAbstractFileByPath("A/B")).toBeNull();
    expect((v.app.vault.getAbstractFileByPath("A") as TFolder).children.map((child) => child.path)).toEqual(["A/C"]);
    expect(v.bodies.get("A/C/x.md")).toBe("x");

    await v.app.fileManager.trashFile(a);
    expect(v.exists("A/C/x.md")).toBe(false);
    expect((v.app.vault.getAbstractFileByPath("A") as TFolder).children).toEqual([]);
    expect(v.trashed).toEqual(["A/C"]);
  });

  it("includes the root folder in getAllLoadedFiles, as the app does", () => {
    const v = new FakeObsidianVault();
    v.file("n.md");
    const root = v.app.vault.getAllLoadedFiles().find((node) => node.path === "/");
    expect(root).toBeInstanceOf(TFolder);
    expect(v.app.vault.getAbstractFileByPath("n.md")?.parent).toBe(root);
  });

  it("refuses what Obsidian refuses: an existing destination or a missing parent", async () => {
    const v = new FakeObsidianVault();
    v.folder("A");
    const file = v.file("A/x.md");
    v.file("A/y.md");
    await expect(v.app.fileManager.renameFile(file, "A/y.md")).rejects.toThrow("already exists");
    await expect(v.app.fileManager.renameFile(file, "Nowhere/x.md")).rejects.toThrow("does not exist");
    await expect(v.app.vault.create("A/y.md", "")).rejects.toThrow("already exists");
    await expect(v.app.vault.create("Nowhere/z.md", "")).rejects.toThrow("does not exist");
    await expect(v.app.vault.createFolder("A")).rejects.toThrow("already exists");
    expect(v.exists("A/x.md")).toBe(true);
  });
});

describe("FakeObsidianVault: frontmatter and the metadata cache", () => {
  it("derives the frontmatter from the text, with real YAML", () => {
    const v = new FakeObsidianVault();
    const file = v.file("n.md", "# T\n", { tipo: "id", jd: "21.11" });
    expect(v.app.metadataCache.getFileCache(file)?.frontmatter).toEqual({ tipo: "id", jd: "21.11" });
    v.file("raw.md", "---\njd: 21.20\nlist: [a, b]\n---\nbody");
    expect(v.frontmatter.get("raw.md")).toEqual({ jd: 21.2, list: ["a", "b"] });
  });

  it("with cacheDelay the cache lags behind writes until flushCache()", async () => {
    const v = new FakeObsidianVault({ cacheDelay: true });
    const file = v.file("n.md", "---\ntipo: nota\n---\n");
    await v.app.vault.process(file, (text) => text.replace("nota", "id"));
    expect(v.frontmatter.get("n.md")).toEqual({ tipo: "id" });
    expect(v.app.metadataCache.getFileCache(file)?.frontmatter).toEqual({ tipo: "nota" });
    const created = await v.app.vault.create("new.md", "---\ntipo: id\n---\n");
    expect(v.app.metadataCache.getFileCache(created)).toBeNull();
    const changed = vi.fn();
    v.app.metadataCache.on("changed", changed);
    v.flushCache();
    expect(v.app.metadataCache.getFileCache(file)?.frontmatter).toEqual({ tipo: "id" });
    expect(v.app.metadataCache.getFileCache(created)?.frontmatter).toEqual({ tipo: "id" });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("processFrontMatter reserialises the block like 1.14.4 (comments dropped) and a throw aborts the write", async () => {
    const v = new FakeObsidianVault();
    const file = v.file("n.md", "---\n# mine\njd: 21.20\n---\nbody\n");
    await expect(v.app.fileManager.processFrontMatter(file, () => { throw new Error("abort"); })).rejects.toThrow("abort");
    expect(v.bodies.get("n.md")).toBe("---\n# mine\njd: 21.20\n---\nbody\n");
    await v.app.fileManager.processFrontMatter(file, (fm) => { Object.assign(fm, { tipo: "id" }); });
    expect(v.bodies.get("n.md")).toBe("---\njd: 21.2\ntipo: id\n---\nbody\n");
  });
});

describe("FakeObsidianVault: events and process", () => {
  it("emits create, modify, rename and delete from the write APIs, and offref stops them", async () => {
    const v = new FakeObsidianVault();
    v.folder("A");
    const seen: string[] = [];
    const vault = v.app.vault as unknown as { on(name: string, handler: (node: { path: string }, old?: string) => void): unknown };
    for (const name of ["create", "modify", "rename", "delete"]) {
      vault.on(name, (node, old) => { seen.push(`${name} ${node.path}${old ? ` <- ${old}` : ""}`); });
    }
    const file = await v.app.vault.create("A/x.md", "1");
    await v.app.vault.modify(file, "2");
    await v.app.vault.process(file, (text) => `${text}3`);
    await v.app.vault.process(file, (text) => text); // unchanged: no event
    await v.app.fileManager.renameFile(file, "A/y.md");
    await v.app.fileManager.trashFile(file);
    expect(seen).toEqual(["create A/x.md", "modify A/x.md", "modify A/x.md", "rename A/y.md <- A/x.md", "delete A/y.md"]);

    const ref = v.app.vault.on("create", () => seen.push("late"));
    v.app.vault.offref(ref);
    await v.app.vault.create("A/z.md", "");
    expect(seen).not.toContain("late");
  });

  it("settle() waits for async handlers, including those started by other handlers", async () => {
    const v = new FakeObsidianVault();
    const order: string[] = [];
    v.app.vault.on("create", async () => { await Promise.resolve(); order.push("first"); v.emit("modify", v.file("m.md")); });
    v.app.vault.on("modify", async () => { await Promise.resolve(); order.push("second"); });
    await v.app.vault.create("c.md", "");
    await v.settle();
    expect(order).toEqual(["first", "second"]);
  });

  it("vault.process aborts the write when the transform throws and sees a concurrent edit", async () => {
    const v = new FakeObsidianVault();
    const file = v.file("n.md", "one");
    await expect(v.app.vault.process(file, () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(v.bodies.get("n.md")).toBe("one");
    v.beforeWrite = (path) => v.bodies.set(path, "concurrent");
    await v.app.vault.process(file, (text) => `${text}+`);
    expect(v.bodies.get("n.md")).toBe("concurrent+");
    expect(file).toBeInstanceOf(TFile);
  });
});

describe("FakeObsidianVault: unmodelled APIs throw", () => {
  it("throws, naming the member, for anything on app, vault, fileManager, metadataCache and workspace that is not modelled", () => {
    const v = new FakeObsidianVault();
    const app = v.app as unknown as Record<string, Record<string, unknown>>;
    expect(() => app.plugins).toThrow("fake-obsidian-vault: app.plugins is not implemented");
    expect(() => app.vault.getFileByPath).toThrow("fake-obsidian-vault: app.vault.getFileByPath is not implemented");
    expect(() => app.vault.append).toThrow("app.vault.append is not implemented");
    expect(() => app.fileManager.generateMarkdownLink).toThrow("app.fileManager.generateMarkdownLink is not implemented");
    expect(() => app.metadataCache.getCache).toThrow("app.metadataCache.getCache is not implemented");
    expect(() => app.workspace.getLeavesOfType).toThrow("app.workspace.getLeavesOfType is not implemented");
  });

  it("a plugin call to an unmodelled API fails the test instead of being swallowed as undefined", async () => {
    const v = new FakeObsidianVault();
    const file = v.file("n.md");
    const touch = () => (v.app.vault as unknown as { adapter: { exists(path: string): Promise<boolean> } }).adapter.exists(file.path);
    expect(touch).toThrow("app.vault.adapter is not implemented");
  });

  it("forbidProcessFrontMatter makes the plugin's use of it fail the test", async () => {
    const v = new FakeObsidianVault({ forbidProcessFrontMatter: true });
    const file = v.file("n.md");
    await expect(v.app.fileManager.processFrontMatter(file, () => {})).rejects.toThrow("must not be used");
  });
});
