// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- DOM fixtures have no Obsidian globals. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import JdexManagerPlugin from "../src/main";
import { buildIndex } from "../src/jd/index";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createId, CreateIdModal } from "../src/ui/create-id";
import { CreateChildModal, CreateHeaderModal } from "../src/ui/create-structure";
import { createJdexNote } from "../src/vault/create";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { notices, resetStub } from "./support/obsidian-stub-api";

const settings = { ...DEFAULT_SETTINGS, jdexFolder: "JDex" };
function fixture() {
  const v = new FakeObsidianVault();
  const paths = ["JDex/21 Category.md", "JDex/21.11 Parent.md"];
  for (const path of paths) v.file(path);
  const index = buildIndex({ systemRoot: "", jdexFolder: "JDex", folderPaths: [], notePaths: paths });
  return { app: v.app, v, create: v.app.vault.create, index, category: index.categories[0], parent: index.ids[0] };
}
const note = (f: { v: FakeObsidianVault }, name: string) => f.v.file(`JDex/${name}.md`);

beforeEach(resetStub);

describe("Obsidian live number validation", () => {
  it("rejects an ID occupied under another title after opening the dialog and proposes the next", async () => {
    const f = fixture();
    const onSubmit = vi.fn(async () => {});
    const modal = new CreateIdModal(f.app, f.index, f.category, settings, onSubmit);
    Object.assign(modal, { title: "Mine" });
    const input = document.createElement("input"); input.className = "jdex-id-input";
    modal.contentEl.append(input);
    note(f, "21.12 Somebody else");
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
    note(f, "21.10 Another header");
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(f.create).not.toHaveBeenCalled();
    expect(input.value).toBe("21.20");
  });

  it("rejects only the same child title on a fresh index", async () => {
    const f = fixture();
    const modal = new CreateChildModal(f.app, f.index, f.parent, settings, async () => {});
    Object.assign(modal, { title: "Child" });
    note(f, "21.11+ Child #tag");
    await (modal as unknown as { submit(): Promise<void> }).submit();
    expect(f.create).not.toHaveBeenCalled();
    await expect(createJdexNote(f.app, settings, "id", "21.11+ Child", {})).rejects.toThrow(/already used/i);
    await createJdexNote(f.app, settings, "id", "21.11+ Another child", {});
    expect(f.create).toHaveBeenCalledOnce();
  });

  it("the write boundary also rejects stale ID/header snapshots with any title", async () => {
    const f = fixture();
    note(f, "21.12 Another title");
    note(f, "21.10 Different header");
    await expect(createId(f.app, settings, f.index, f.category, { id: "21.12", title: "Mine", createFolder: false, createPattern: false })).rejects.toThrow(/already used/i);
    await expect(createJdexNote(f.app, settings, "cabecera", "21.10 ■ Mine", {})).rejects.toThrow(/already used/i);
    expect(f.create).not.toHaveBeenCalled();
    await createId(f.app, settings, f.index, f.category, { id: "21.13", title: "Free", createFolder: false, createPattern: false });
    expect(f.create).toHaveBeenCalledOnce();
  });

  it("reports removal of the number and journals the rename for undo", async () => {
    const f = fixture();
    const saveData = vi.fn(async () => {});
    const plugin = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, { app: f.app, settings, loadData: async () => JSON.parse(JSON.stringify(settings)) as unknown, saveData }) as unknown as JdexManagerPlugin;
    await plugin.loadSettings();
    const renamed = note(f, "Parent");
    await plugin.onRename(renamed, "JDex/21.11 Parent.md");
    // English Obsidian (the stub's locale); no clickable «Deshacer», the notice names the undo command.
    expect(notices().at(-1)).toBe("21.11 lost its number: an ID is never renumbered (johnnydecimal.com). Run «Undo last JDex operation» to put it back.");
    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ journal: [expect.objectContaining({ effects: [expect.objectContaining({ kind: "moved", from: "JDex/21.11 Parent.md", to: "JDex/Parent.md", type: "file" })] })] }));
  });
});
