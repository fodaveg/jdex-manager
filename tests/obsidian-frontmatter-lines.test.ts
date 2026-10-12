/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import type { Effect, Operation } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { frontmatterBlock } from "../src/vault/frontmatter-lines";
import { retireId } from "../src/vault/retire";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

const NOTE = "J/21.11 Nota.md";
const BODY = [
  "---",
  "# Comentario de cabecera del usuario",
  "jd: 21.20",
  "tipo: 'id'   # tipo puesto a mano",
  'descripcion: "Algo: con dos puntos"',
  "aliases: [uno, \"dos\"]",
  "---",
  "# 21.11 Nota",
  "",
].join("\n");

/** The shared vault double: `processFrontMatter` is its mock, and the text is the only state. */
function textVault(initial: Record<string, string>, folders: string[] = []) {
  const v = new FakeObsidianVault();
  for (const folder of folders) v.folder(folder);
  for (const [path, body] of Object.entries(initial)) v.file(path, body);
  return { app: v.app, bodies: v.bodies, processFrontMatter: v.app.fileManager.processFrontMatter, renameFile: v.app.fileManager.renameFile };
}

describe("Obsidian frontmatter writes touch only their keys", () => {
  it("an audit fix keeps the user's comments, quoting and lists, and undo restores the exact text", async () => {
    const { app, bodies, processFrontMatter } = textVault({ [NOTE]: BODY });
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: NOTE, set: { jd: "21.20", area: "20-29 Area" } }, effects);
    const after = bodies.get(NOTE)!;
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(after).toContain("# Comentario de cabecera del usuario");
    expect(after).toContain("tipo: 'id'   # tipo puesto a mano");
    expect(after).toContain('aliases: [uno, "dos"]');
    expect(after).toContain('jd: "21.20"');
    expect(after).toContain('area: "20-29 Area"');
    expect(effects).toEqual([{ kind: "frontmatter-block", path: NOTE, before: frontmatterBlock(BODY), after: frontmatterBlock(after) }]);
    const op = JSON.parse(JSON.stringify({ kind: "fix", label: "Reparar", at: "2026-10-12", effects })) as Operation;
    await undoOperation(app, op);
    expect(bodies.get(NOTE)).toBe(BODY);
  });

  it("an audit fix still skips a field that changed since the audit", async () => {
    const { app, bodies } = textVault({ [NOTE]: BODY });
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: NOTE, set: { descripcion: "Propuesta." }, expected: { descripcion: "Otra cosa" } }, effects);
    expect(bodies.get(NOTE)).toBe(BODY);
    expect(effects).toEqual([]);
  });

  it("a frontmatter that cannot be patched safely is left alone instead of being reserialised", async () => {
    const duplicated = "---\ntipo: id\ntipo: otro\n# mío\n---\n# 21.11 Nota\n";
    const { app, bodies, processFrontMatter } = textVault({ [NOTE]: duplicated });
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: NOTE, set: { jd: "21.11" } }, effects);
    expect(bodies.get(NOTE)).toBe(duplicated);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });

  it("retiring keeps comments and the unquoted jd text, and records an exact rewrite", async () => {
    const folder = "20-29 Area/21 Cat/21.11 Nota";
    const { app, bodies, processFrontMatter } = textVault({ [NOTE]: BODY }, [folder, "20-29 Area/21 Cat/21.09 Archivo"]);
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", folder, "20-29 Area/21 Cat/21.09 Archivo"] });
    const effects: Effect[] = [];
    await retireId(app, index, index.ids.find((entry) => entry.id === "21.11")!, undefined, effects);
    const after = bodies.get(NOTE)!;
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(after).toContain("jd: 21.20\n");
    expect(after).toContain("# Comentario de cabecera del usuario");
    // Same as Hebra's writer: the inline comment stays, after a single space.
    expect(after).toContain('tipo: "archivado" # tipo puesto a mano');
    expect(effects[0]).toMatchObject({ kind: "frontmatter-block", path: NOTE, before: frontmatterBlock(BODY) });
  });

  it("retiring a note whose frontmatter cannot be patched fails before touching the folder", async () => {
    const folder = "20-29 Area/21 Cat/21.11 Nota";
    const duplicated = "---\ntipo: id\ntipo: otro\n---\n# 21.11 Nota\n";
    const { app, bodies, renameFile } = textVault({ [NOTE]: duplicated }, [folder, "20-29 Area/21 Cat/21.09 Archivo"]);
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", folder, "20-29 Area/21 Cat/21.09 Archivo"] });
    const effects: Effect[] = [];
    await expect(retireId(app, index, index.ids.find((entry) => entry.id === "21.11")!, undefined, effects)).rejects.toThrow(/cannot be changed safely/);
    expect(bodies.get(NOTE)).toBe(duplicated);
    expect(renameFile).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });
});
