/**
 * Code review of 12 Oct 2026, finding 4: «Create ID» did not check that the JDex folder exists,
 * unlike the other creators (`createJdexNote`), so it could recreate a renamed or deleted JDex
 * folder at its old path with a single note in it.
 */
import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/jd/settings";
import { createId } from "../src/ui/create-id";
import { scanVault } from "../src/vault/scan";
import type { Effect } from "../src/jd/journal";
import { fakeVault } from "./support/fake-obsidian-vault";

function vault(withJdex: boolean) {
  const v = fakeVault();
  for (const path of ["20-29 Area", "20-29 Area/21 Cat"]) v.folder(path);
  if (withJdex) v.folder("J");
  else v.file("J renamed/21.01 Inbox.md", "# 21.01 Inbox\n");
  return v;
}

describe("Create ID refuses a missing JDex folder (finding 4)", () => {
  it("throws the same error as the other creators and creates nothing", async () => {
    const v = vault(false);
    const settings = mergeSettings({ jdexFolder: "J" });
    const index = scanVault(v.app, settings);
    const category = index.categories.find((c) => c.number === "21")!;
    const effects: Effect[] = [];
    await expect(createId(v.app, settings, index, category, { id: "21.11", title: "New", createFolder: false, createPattern: false }, effects))
      .rejects.toThrow("The JDex folder (J) does not exist");
    expect(v.exists("J")).toBe(false);
    expect(v.exists("J/21.11 New.md")).toBe(false);
    expect(effects).toEqual([]);
  });

  it("control: with the JDex folder in place it creates the note", async () => {
    const v = vault(true);
    const settings = mergeSettings({ jdexFolder: "J" });
    const index = scanVault(v.app, settings);
    const category = index.categories.find((c) => c.number === "21")!;
    const note = await createId(v.app, settings, index, category, { id: "21.11", title: "New", createFolder: false, createPattern: false });
    expect(note.path).toBe("J/21.11 New.md");
  });
});
