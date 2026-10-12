import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { type Effect, type Operation, removeInsertedLine, undoWarnings } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { retireId } from "../src/vault/retire";
import { fakeVault } from "./obsidian-journal-fake";

const NOTE = "J/21.11 Note.md";
const op = (effects: Effect[], kind: Operation["kind"] = "fix"): Operation => ({ kind, label: "Test", at: "2026-10-12T10:00:00.000Z", effects });

function retireSetup(body = "---\ntipo: id\n---\n# 21.11 Note\n\nBody.\n") {
  const v = fakeVault();
  for (const path of ["J", "20-29 Area", "20-29 Area/21 Cat", "20-29 Area/21 Cat/21.11 Note", "20-29 Area/21 Cat/21.09 Archive"]) v.folder(path);
  v.file(NOTE, body, { tipo: "id", descripcion: "Mine" });
  v.file("20-29 Area/21 Cat/21.11 Note/doc.pdf", "pdf");
  const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", "20-29 Area/21 Cat/21.11 Note", "20-29 Area/21 Cat/21.09 Archive"] });
  return { v, index, entry: index.ids.find((e) => e.id === "21.11")! };
}

describe("Obsidian frontmatter inverse", () => {
  it("keeps a description written by hand after the fix and changes no key (inverted probe)", async () => {
    const v = fakeVault();
    v.file(NOTE, "# 21.11 Note\n", { tipo: "nota", descripcion: "Old" });
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: NOTE, set: { tipo: "id", descripcion: "Fixed" } }, effects);
    expect(effects[0]).toMatchObject({ kind: "frontmatter", written: { tipo: "id", descripcion: "Fixed" } });
    v.frontmatter.get(NOTE)!.descripcion = "Written by hand";
    const operation = op(effects);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("descripcion");
    expect(v.frontmatter.get(NOTE)).toEqual({ tipo: "id", descripcion: "Written by hand" });
    expect(operation.effects).toHaveLength(1);
  });

  it("restores every key when nothing changed (control)", async () => {
    const v = fakeVault();
    v.file(NOTE, "# 21.11 Note\n", { tipo: "nota", descripcion: "Old" });
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: NOTE, set: { tipo: "id", jd: "21.11" } }, effects);
    const operation = op(effects);
    await undoOperation(v.app, operation);
    expect(v.frontmatter.get(NOTE)).toEqual({ tipo: "nota", descripcion: "Old" });
    expect(operation.effects).toHaveLength(0);
  });

  it("refuses an entry from 0.3.x/0.4.x without confirmation and one whose keys were lost always", async () => {
    const v = fakeVault();
    v.file(NOTE, "# 21.11 Note\n", { tipo: "archivado", archivado: "2026-09-01" });
    const legacy = op([{ kind: "frontmatter", path: NOTE, previous: { tipo: "id" } }]);
    expect(undoWarnings(legacy).join(" ")).toContain("older version");
    await expect(undoOperation(v.app, legacy)).rejects.toThrow("confirm");
    expect(v.frontmatter.get(NOTE)).toEqual({ tipo: "archivado", archivado: "2026-09-01" });
    const done = await undoOperation(v.app, legacy, undefined, { confirmedLegacy: true });
    expect(done.join(" ")).toContain("older entry");
    expect(v.frontmatter.get(NOTE)).toEqual({ tipo: "id", archivado: "2026-09-01" });
    const lost = op([{ kind: "frontmatter", path: NOTE, previous: {} }]);
    await expect(undoOperation(v.app, lost, undefined, { confirmedLegacy: true })).rejects.toThrow("did not keep which keys");
    expect(lost.effects).toHaveLength(1);
  });
});

describe("Obsidian retire inverse", () => {
  it("undoes a retirement completely when nothing changed (control)", async () => {
    const { v, index, entry } = retireSetup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    const before = v.bodies.get(NOTE)!;
    expect(before).toContain("Retirado el");
    const operation = op(effects, "retire");
    await undoOperation(v.app, operation);
    expect(v.bodies.get(NOTE)).toBe("---\ntipo: id\n---\n# 21.11 Note\n\nBody.\n");
    expect(v.frontmatter.get(NOTE)).toEqual({ tipo: "id", descripcion: "Mine" });
    expect(v.exists("20-29 Area/21 Cat/21.11 Note/doc.pdf")).toBe(true);
  });

  it("keeps a retirement date edited by hand and keeps that step in the journal", async () => {
    const { v, index, entry } = retireSetup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    v.frontmatter.get(NOTE)!.archivado = "2020-01-01";
    const operation = op(effects, "retire");
    await expect(undoOperation(v.app, operation)).rejects.toThrow("archivado");
    expect(v.frontmatter.get(NOTE)).toMatchObject({ tipo: "archivado", archivado: "2020-01-01" });
    expect(operation.effects.map((e) => e.kind)).toEqual(["frontmatter"]);
  });

  it("removes the line of a note without H1 from right after the frontmatter", async () => {
    const { v, index, entry } = retireSetup("---\ntipo: id\n---\nNo heading here.\n");
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    expect(v.bodies.get(NOTE)!.split("\n")[3]).toContain("Retirado el");
    await undoOperation(v.app, op(effects.filter((e) => e.kind === "line")));
    expect(v.bodies.get(NOTE)).toBe("---\ntipo: id\n---\nNo heading here.\n");
  });
});

describe("Obsidian line inverse", () => {
  const line = "Retirado el 2026-10-12.";

  it("keeps an edit that lands while the line is being removed", async () => {
    const v = fakeVault();
    v.file(NOTE, `# 21.11 Note\n${line}\nBody.\n`);
    v.beforeWrite = (path) => v.bodies.set(path, v.bodies.get(path)! + "Concurrent.\n");
    await undoOperation(v.app, op([{ kind: "line", path: NOTE, line }]));
    expect(v.bodies.get(NOTE)).toBe("# 21.11 Note\nBody.\nConcurrent.\n");
  });

  it("leaves a line the user moved elsewhere and keeps the step", async () => {
    const v = fakeVault();
    v.file(NOTE, `# 21.11 Note\nBody.\n${line}\n`);
    const operation = op([{ kind: "line", path: NOTE, line }]);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("no longer where it was inserted");
    expect(v.bodies.get(NOTE)).toBe(`# 21.11 Note\nBody.\n${line}\n`);
    expect(operation.effects).toHaveLength(1);
  });

  it("finds the anchor below the frontmatter and reports an absent line", () => {
    expect(removeInsertedLine(`---\na: 1\n---\n# T\n${line}\nB`, line)).toEqual({ content: "---\na: 1\n---\n# T\nB" });
    expect(removeInsertedLine("# T\nB", line)).toEqual({ missing: "absent" });
  });
});

describe("Obsidian move inverse", () => {
  it("does not move back another file that reused the destination path", async () => {
    const v = fakeVault();
    v.folder("A");
    v.folder("B");
    const moved = v.file("A/x.pdf", "pdf", undefined, 5);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "rename", from: "A/x.pdf", to: "B/x.pdf" } as never, effects);
    expect(effects[0]).toMatchObject({ kind: "moved", type: "file", ctime: 5 });
    await v.app.fileManager.trashFile(moved);
    v.file("B/x.pdf", "other", undefined, 99);
    const operation = op(effects, "move");
    await expect(undoOperation(v.app, operation)).rejects.toThrow("not the item that was moved");
    expect(v.exists("B/x.pdf")).toBe(true);
    expect(v.exists("A/x.pdf")).toBe(false);
  });

  it("moves the same file back (control)", async () => {
    const v = fakeVault();
    v.folder("A");
    v.folder("B");
    v.file("A/x.pdf", "pdf", undefined, 5);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "rename", from: "A/x.pdf", to: "B/x.pdf" } as never, effects);
    await undoOperation(v.app, op(effects, "move"));
    expect(v.exists("A/x.pdf")).toBe(true);
  });
});
