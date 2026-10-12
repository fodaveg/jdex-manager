import { describe, expect, it } from "vitest";
import { planMoveToId, type MoveToIdHost } from "../src/jd/files";
import { buildIndex } from "../src/jd/index";

const settings = { jdexFolder: "JDex", templatesFolder: "", reportsFolder: "" };
const OBSIDIAN: MoveToIdHost = { createMissingFolder: true, dateOnMove: true };
const HEBRA: MoveToIdHost = { createMissingFolder: false, dateOnMove: false };

function index() {
  const folderPaths: string[] = [];
  const notePaths: string[] = [];
  for (const system of ["", "D01", "D02"]) {
    const p = system ? `${system}.` : "";
    folderPaths.push(`${p}20-29 Area`, `${p}20-29 Area/${p}21 Category`, `${p}20-29 Area/${p}21 Category/${p}21.12 Has folder`, `${p}20-29 Area/${p}21 Category/${p}21.01 Inbox`);
    notePaths.push(`JDex/${p}21.11 No folder.md`, `JDex/${p}21.12 Has folder.md`, `JDex/${p}21.01 Inbox.md`);
  }
  notePaths.push("JDex/31.11 Orphan category.md");
  return buildIndex({ systemRoot: "", folderPaths, jdexFolder: "JDex", notePaths });
}

function entry(id: string, system = "") {
  const found = index().ids.find((e) => e.id === id && (e.system ?? "") === system);
  if (!found) throw new Error(`no ${system}.${id}`);
  return found;
}

describe("planMoveToId: one decision, each host keeps its behaviour", () => {
  it("moves into an existing folder in both hosts; only Obsidian dates, and only a content ID", () => {
    expect(planMoveToId(index(), settings, entry("21.12"), "a.pdf", OBSIDIAN)).toEqual({ type: "move", folder: "20-29 Area/21 Category/21.12 Has folder", date: true });
    expect(planMoveToId(index(), settings, entry("21.12"), "a.pdf", HEBRA)).toEqual({ type: "move", folder: "20-29 Area/21 Category/21.12 Has folder", date: false });
    expect(planMoveToId(index(), settings, entry("21.01"), "a.pdf", OBSIDIAN)).toMatchObject({ type: "move", date: false });
    expect(planMoveToId(index(), settings, entry("21.12"), "a.pdf", { ...OBSIDIAN, dateOnMove: false })).toMatchObject({ date: false });
  });

  it("Obsidian creates the missing folder in the category of the ID's own system", () => {
    expect(planMoveToId(index(), settings, entry("21.11", "D02"), "a.pdf", OBSIDIAN)).toEqual({
      type: "create-folder",
      folder: "D02.20-29 Area/D02.21 Category/D02.21.11 No folder",
      date: false,
    });
    expect(planMoveToId(index(), settings, entry("21.11"), "a.pdf", OBSIDIAN)).toMatchObject({ type: "create-folder", folder: "20-29 Area/21 Category/21.11 No folder" });
  });

  it("Hebra never creates a folder on a move: an ID without one is not a destination there", () => {
    expect(planMoveToId(index(), settings, entry("21.11", "D01"), "a.pdf", HEBRA)).toEqual({ type: "no-folder", reason: "host-does-not-create" });
  });

  it("refuses when the category has no folder to create the ID folder in", () => {
    expect(planMoveToId(index(), settings, entry("31.11"), "a.pdf", OBSIDIAN)).toEqual({ type: "no-folder", reason: "no-category-folder" });
  });
});
