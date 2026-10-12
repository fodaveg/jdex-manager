/**
 * Code review of 12 Oct 2026, finding 12: undoing a move identifies the file by its ctime. Where
 * ctime follows mtime (Android), the moved file no longer matched and the undo was blocked. Now,
 * when the ctime does not match but the path, the name and the size do, the undo goes ahead and
 * says so.
 */
import { describe, expect, it } from "vitest";
import type { Effect } from "../src/jd/journal";
import { movedIdentity, undoOperation } from "../src/vault/journal";
import { fakeVault } from "./support/fake-obsidian-vault";

function movedFile(body = "contenido del fichero") {
  const v = fakeVault();
  v.folder("A");
  v.folder("B");
  const file = v.file("B/doc.md", body, undefined, 5000);
  const effect: Effect = { kind: "moved", from: "A/doc.md", to: "B/doc.md", ...movedIdentity(file) };
  return { v, file, effect };
}

describe("Undoing a move when the creation time changed (finding 12)", () => {
  it("records the size of a moved file", () => {
    const { effect, file } = movedFile();
    expect(effect).toMatchObject({ type: "file", ctime: 5000, size: file.stat.size });
  });

  it("moves it back when only the ctime changed, and says how it recognised it", async () => {
    const { v, file, effect } = movedFile();
    file.stat.ctime = 9999; // Android: ctime follows mtime.
    const done = await undoOperation(v.app, { kind: "move", label: "Move", at: "2026-10-12", effects: [effect] });
    expect(v.exists("A/doc.md")).toBe(true);
    expect(done.join(" ")).toContain("path, name and size");
  });

  it("control: a different ctime and a different size is another file, and stays", async () => {
    const { v, file, effect } = movedFile();
    file.stat.ctime = 9999;
    file.stat.size += 10;
    await expect(undoOperation(v.app, { kind: "move", label: "Move", at: "2026-10-12", effects: [effect] })).rejects.toThrow("not the item");
    expect(v.exists("B/doc.md")).toBe(true);
  });

  it("control: an entry without a recorded size still refuses on a ctime mismatch", async () => {
    const { v, file } = movedFile();
    file.stat.ctime = 9999;
    const old: Effect = { kind: "moved", from: "A/doc.md", to: "B/doc.md", type: "file", ctime: 5000 };
    await expect(undoOperation(v.app, { kind: "move", label: "Move", at: "2026-10-12", effects: [old] })).rejects.toThrow("not the item");
  });
});
