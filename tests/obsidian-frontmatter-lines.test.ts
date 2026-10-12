import { describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import { parse, stringify } from "yaml";
import { buildIndex } from "../src/jd/index";
import type { Effect, Operation } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { retireId } from "../src/vault/retire";

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

/**
 * Obsidian 1.14.4's processFrontMatter, as read from obsidian-1.14.4.asar: parse the
 * block to an object, run the callback, stringify the object and splice it back.
 */
function obsidianProcessFrontMatter(text: string, fn: (fm: Record<string, unknown>) => void): string {
  const match = /^---\n([\s\S]*?\n)---(?:\n|$)/u.exec(text);
  const fm = (match ? (parse(match[1]) as Record<string, unknown> | null) : null) ?? {};
  fn(fm);
  const out = stringify(fm);
  return match ? text.slice(0, 4) + out + text.slice(4 + match[1].length) : `---\n${out}---\n${text}`;
}

function textVault(initial: Record<string, string>, folders: string[] = []) {
  const bodies = new Map(Object.entries(initial));
  const fileAt = (path: string) => Object.assign(new TFile(), { path, basename: path.slice(path.lastIndexOf("/") + 1, -3), extension: "md" });
  const processFrontMatter = vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
    bodies.set(file.path, obsidianProcessFrontMatter(bodies.get(file.path)!, fn));
  });
  const renameFile = vi.fn(async () => {});
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (bodies.has(path) ? fileAt(path) : folders.includes(path) ? { path } : null),
      read: async (file: TFile) => bodies.get(file.path)!,
      process: async (file: TFile, update: (current: string) => string) => {
        const next = update(bodies.get(file.path)!);
        bodies.set(file.path, next);
        return next;
      },
      modify: async (file: TFile, text: string) => {
        bodies.set(file.path, text);
      },
    },
    fileManager: { processFrontMatter, renameFile },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
  return { app, bodies, processFrontMatter, renameFile };
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
    expect(effects).toEqual([{ kind: "note-rewrite", path: NOTE, before: BODY, after }]);
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
    const { app, bodies, processFrontMatter } = textVault({ [NOTE]: BODY }, [folder]);
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", folder, "20-29 Area/21 Cat/21.09 Archivo"] });
    const effects: Effect[] = [];
    await retireId(app, index, index.ids.find((entry) => entry.id === "21.11")!, undefined, effects);
    const after = bodies.get(NOTE)!;
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(after).toContain("jd: 21.20\n");
    expect(after).toContain("# Comentario de cabecera del usuario");
    // Same as Hebra's writer: the inline comment stays, after a single space.
    expect(after).toContain('tipo: "archivado" # tipo puesto a mano');
    expect(effects[0]).toMatchObject({ kind: "note-rewrite", path: NOTE, before: BODY });
  });

  it("retiring a note whose frontmatter cannot be patched fails before touching the folder", async () => {
    const folder = "20-29 Area/21 Cat/21.11 Nota";
    const duplicated = "---\ntipo: id\ntipo: otro\n---\n# 21.11 Nota\n";
    const { app, bodies, renameFile } = textVault({ [NOTE]: duplicated }, [folder]);
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", folder, "20-29 Area/21 Cat/21.09 Archivo"] });
    const effects: Effect[] = [];
    await expect(retireId(app, index, index.ids.find((entry) => entry.id === "21.11")!, undefined, effects)).rejects.toThrow(/no se puede modificar sin riesgo/);
    expect(bodies.get(NOTE)).toBe(duplicated);
    expect(renameFile).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });
});
