/**
 * Code review of 12 Oct 2026, finding 6: frontmatter corrections journaled the whole note before
 * and after (note-rewrite), so data.json grew with every repaired note and an edit to the body
 * after the repair blocked its undo. Decision: journal only the frontmatter block, and undo
 * compares and restores only that block. Old note-rewrite entries still undo as before.
 */
import { describe, expect, it, vi } from "vitest";
import { mergeSettings } from "../src/jd/settings";
import type { Effect, Operation } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { PluginDataFile } from "../src/vault/journal-store";
import { fakeVault } from "./support/fake-obsidian-vault";

const BODY = `# 21.11 Nota\n\n${"Texto de la nota con algo de contenido real, enlaces [[21.12 Otra]] y una lista.\n- uno\n- dos\n".repeat(16)}`;
const NOTE = `---\ndescripcion: Una descripción\njd: "99.99"\n---\n${BODY}`;

describe("Frontmatter corrections journal only the frontmatter block (finding 6)", () => {
  it("records the block, not the note, and undo restores it even after the body was edited", async () => {
    const v = fakeVault();
    v.file("J/21.11 Nota.md", NOTE);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 Nota.md", set: { jd: "21.11", tipo: "id" } }, effects);
    expect(effects).toEqual([{ kind: "frontmatter-block", path: "J/21.11 Nota.md", before: '---\ndescripcion: Una descripción\njd: "99.99"\n---\n', after: '---\ndescripcion: Una descripción\njd: "21.11"\ntipo: "id"\n---\n' }]);
    // The user edits the body after the repair.
    v.bodies.set("J/21.11 Nota.md", `${v.bodies.get("J/21.11 Nota.md")!}\nAñadido después.\n`);
    const op = JSON.parse(JSON.stringify({ kind: "fix", label: "Reparar", at: "2026-10-12", effects })) as Operation;
    await undoOperation(v.app, op);
    expect(v.bodies.get("J/21.11 Nota.md")).toBe(`${NOTE}\nAñadido después.\n`);
  });

  it("refuses to undo when the frontmatter itself changed after the repair", async () => {
    const v = fakeVault();
    v.file("J/21.11 Nota.md", NOTE);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 Nota.md", set: { jd: "21.11" } }, effects);
    v.setFm("J/21.11 Nota.md", "descripcion", "Cambiada a mano");
    const edited = v.bodies.get("J/21.11 Nota.md");
    await expect(undoOperation(v.app, { kind: "fix", label: "Reparar", at: "2026-10-12", effects })).rejects.toThrow("frontmatter");
    expect(v.bodies.get("J/21.11 Nota.md")).toBe(edited);
  });

  it("restores a note that had no frontmatter to no frontmatter", async () => {
    const v = fakeVault();
    v.file("J/21.11 Nota.md", BODY);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 Nota.md", set: { jd: "21.11" } }, effects);
    expect(v.bodies.get("J/21.11 Nota.md")).toContain('jd: "21.11"');
    await undoOperation(v.app, { kind: "fix", label: "Reparar", at: "2026-10-12", effects });
    expect(v.bodies.get("J/21.11 Nota.md")).toBe(BODY);
  });

  it("control: a note-rewrite entry saved by an earlier version still undoes", async () => {
    const v = fakeVault();
    v.file("J/21.11 Nota.md", "after");
    await undoOperation(v.app, { kind: "fix", label: "Old", at: "2026-10-01", effects: [{ kind: "note-rewrite", path: "J/21.11 Nota.md", before: "before", after: "after" }] });
    expect(v.bodies.get("J/21.11 Nota.md")).toBe("before");
  });

  it("measures data.json after repairing 200 notes, saved after each effect", async () => {
    const v = fakeVault();
    v.folder("J");
    for (let i = 0; i < 200; i += 1) v.file(`J/21.${String(11 + (i % 80)).padStart(2, "0")} Nota ${i}.md`, NOTE);
    let stored: unknown = null;
    const io = { load: vi.fn(async (): Promise<unknown> => (stored === null ? null : JSON.parse(JSON.stringify(stored)) as unknown)), save: vi.fn(async (data: unknown) => { stored = JSON.parse(JSON.stringify(data)); }) };
    const data = new PluginDataFile(io, mergeSettings({ jdexFolder: "J" }), "dev-A");
    await data.load();
    const sink = data.journal.begin("fix", "Reparar JDex");
    for (const file of v.app.vault.getMarkdownFiles()) await applyFix(v.app, { type: "frontmatter", path: file.path, set: { jd: "21.11", tipo: "id" } }, sink);
    await sink.flush();
    expect(io.save).toHaveBeenCalledTimes(200);
    const bytes = new TextEncoder().encode(JSON.stringify(stored)).length;
    const noteBytes = new TextEncoder().encode(NOTE).length;
    // Measured 12 Oct 2026 (notes of 1552 bytes): 662108 bytes with whole-note entries, 42308 with blocks.
    expect(bytes).toBeLessThan(200 * noteBytes * 0.5);
  });
});
