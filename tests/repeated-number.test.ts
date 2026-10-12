/**
 * Audit 12 Oct 2026 (write integrity), finding 3: a number repeated by two offline devices
 * must not mix the pair. Engine: separate entries, only duplicate-id. Obsidian: the actions
 * that pick "the" note or folder of the number refuse it. Nothing is renumbered.
 */
import { describe, expect, it, vi } from "vitest";
import { type App, TFile, TFolder } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { auditSystem } from "../src/jd/audit";
import { buildIndex, isRepeatedId, repeatedIdMessage } from "../src/jd/index";
import { mergeSettings } from "../src/jd/settings";
import { titleForCompare } from "../src/jd/title";

const notices = vi.hoisted(() => [] as string[]);
const confirms = vi.hoisted(() => ({ count: 0 }));
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Notice: class { constructor(message: string) { notices.push(message); } },
}));
vi.mock("../src/ui/confirm", () => ({
  confirm: async () => {
    confirms.count += 1;
    return false;
  },
}));

const J = "J";
const FOLDERS = ["20-29 A", "20-29 A/21 C", "20-29 A/21 C/21.23 Alfa"];
const index = (notes: string[], folders = FOLDERS) => buildIndex({ systemRoot: "", jdexFolder: J, folderPaths: folders, notePaths: notes.map((n) => `${J}/${n}.md`) });
const kinds = (notes: string[], folders = FOLDERS) => {
  const idx = index(notes, folders);
  return auditSystem({ index: idx, notes: notes.map((n) => ({ path: `${J}/${n}.md`, frontmatter: { descripcion: "x" } })), filePaths: [] })
    .filter((finding) => finding.number?.includes("21.23") && ["duplicate-id", "name-mismatch", "note-without-folder", "folder-without-note"].includes(finding.kind))
    .map((finding) => finding.kind)
    .sort();
};

describe("engine: a repeated number is never merged (37c115ca)", () => {
  it("keeps Alfa and Beta as two entries and pairs the folder with its own title, whatever the order", () => {
    for (const notes of [["21.23 Alfa", "21.23 Beta"], ["21.23 Beta", "21.23 Alfa"]]) {
      const entries = index(notes).ids.filter((entry) => entry.id === "21.23");
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.title === "Alfa")).toMatchObject({ notePath: "J/21.23 Alfa.md", folderPath: "20-29 A/21 C/21.23 Alfa" });
      expect(entries.find((entry) => entry.title === "Beta")).toMatchObject({ notePath: "J/21.23 Beta.md" });
      expect(entries.find((entry) => entry.title === "Beta")?.folderPath).toBeUndefined();
    }
  });

  it("two folders with one number are two entries too", () => {
    const entries = index([], [...FOLDERS, "20-29 A/21 C/21.23 Otra"]).ids.filter((entry) => entry.id === "21.23");
    expect(entries.map((entry) => entry.folderPath).sort()).toEqual(["20-29 A/21 C/21.23 Alfa", "20-29 A/21 C/21.23 Otra"]);
  });

  it("with Alfa and Beta repeated only duplicate-id is reported", () => {
    expect(kinds(["21.23 Alfa", "21.23 Beta"])).toEqual(["duplicate-id"]);
    expect(kinds(["21.23 Beta", "21.23 Alfa"])).toEqual(["duplicate-id"]);
  });

  it("control: a single note with another title is still a name mismatch", () => {
    expect(kinds(["21.23 Beta"])).toEqual(["name-mismatch"]);
  });

  it("the same number in D01 and D02 is not a duplicate", () => {
    const idx = index(["D01.21.23 Alfa", "D02.21.23 Beta"], []);
    expect(isRepeatedId(idx, { id: "21.23", system: "D01", title: "Alfa" })).toBe(false);
    expect(kinds(["D01.21.23 Alfa", "D02.21.23 Beta"], []).filter((kind) => kind === "duplicate-id")).toEqual([]);
  });

  it("reports + children repeated with the same title, not different titles", () => {
    const notes = ["21.23 Alfa", "21.23+ Hijo", "21.23+ Hijo #tag", "21.23+ Otro"];
    const idx = index(notes);
    const findings = auditSystem({ index: idx, notes: notes.map((n) => ({ path: `${J}/${n}.md`, frontmatter: { descripcion: "x" } })), filePaths: [] });
    const duplicates = findings.filter((finding) => finding.kind === "duplicate-id");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].paths).toEqual(["J/21.23+ Hijo.md", "J/21.23+ Hijo #tag.md"]);
    expect(isRepeatedId(idx, { id: "21.23+", title: "Hijo" })).toBe(true);
    expect(isRepeatedId(idx, { id: "21.23+", title: "Otro" })).toBe(false);
  });

  it("Hebra's tie-break suffix is not part of the compared title", () => {
    expect(titleForCompare("Alfa--1a2b3c4d")).toBe("Alfa");
    expect(titleForCompare("Alfa #tag--1a2b")).toBe("Alfa");
    expect(titleForCompare("Pre--post")).toBe("Pre--post");
  });

  it("the refusal names the number and changes nothing", () => {
    expect(repeatedIdMessage({ id: "21.23", system: "D01" })).toContain("D01.21.23 está repetido");
  });
});

describe("Obsidian: actions on a repeated number are refused (37c115ca)", () => {
  function plugin(noteNames: string[]) {
    const folders = FOLDERS.map((path) => Object.assign(new TFolder(), { path, name: path.slice(path.lastIndexOf("/") + 1) }));
    const files = noteNames.map((name) => Object.assign(new TFile(), { path: `${J}/${name}.md`, name: `${name}.md`, basename: name, extension: "md" }));
    const app = {
      vault: { getAllLoadedFiles: () => [...folders, ...files], getAbstractFileByPath: (path: string) => [...folders, ...files].find((f) => f.path === path) ?? null },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      workspace: { getActiveFile: () => files[0] },
    } as unknown as App;
    return Object.assign(Object.create(JdexManagerPlugin.prototype) as object, { app, settings: mergeSettings({ jdexFolder: J }), journal: [] }) as unknown as JdexManagerPlugin;
  }

  it("retiring 21.23 is refused with a notice, without asking", async () => {
    confirms.count = 0;
    await plugin(["21.23 Alfa", "21.23 Beta"]).retireFlow({ id: "21.23" });
    expect(notices.at(-1)).toContain("21.23 is repeated");
    expect(confirms.count).toBe(0);
  });

  it("control: a unique number reaches the confirmation", async () => {
    confirms.count = 0;
    await plugin(["21.23 Alfa"]).retireFlow({ id: "21.23" });
    expect(confirms.count).toBe(1);
  });

  it("toggling note and folder is refused", async () => {
    notices.length = 0;
    await plugin(["21.23 Alfa", "21.23 Beta"]).toggleNoteAndFolder();
    expect(notices.at(-1)).toContain("21.23 is repeated");
  });
});
