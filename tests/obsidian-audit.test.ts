// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { auditSystem, type Finding } from "../src/jd/audit";
import { buildIndex } from "../src/jd/index";
import type { Effect, Operation } from "../src/jd/journal";
import { DEFAULT_SETTINGS } from "../src/settings";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { FixFindingsModal } from "../src/ui/audit";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { installObsidianDom } from "./support/obsidian-dom";
import { buttons, isOpen, notices, resetStub, toggles } from "./support/obsidian-stub-api";

installObsidianDom();

beforeEach(resetStub);

describe("Obsidian audit fixes", () => {
  it("removes originally absent frontmatter after a repair journal survives JSON storage", async () => {
    const v = new FakeObsidianVault();
    const original = "---\ndescripcion: Texto existente\narea:\n---\n# 21.22 X\n";
    const file = v.file("JDex/21.22 X.md", original);
    const effects: Effect[] = [];
    await applyFix(v.app, { type: "frontmatter", path: file.path, set: { jd: "21.22", tipo: "id", area: "20-29", categoria: "21" } }, effects);
    expect(v.bodies.get(file.path)).toContain('categoria: "21"');
    const reloaded = JSON.parse(JSON.stringify({ kind: "fix", label: "Reparar", at: "2026-10-05", effects })) as Operation;
    await undoOperation(v.app, reloaded);
    expect(v.bodies.get(file.path)).toBe(original);
  });

  it("normalizes every frontmatter writer before saving the Obsidian journal", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    let saved: unknown;
    Object.assign(plugin, { loadData: async () => saved ?? null, saveData: vi.fn(async (data: unknown) => { saved = JSON.parse(JSON.stringify(data)); }) });
    await plugin.loadSettings();
    await plugin.record("retire", "Retirar", [{ kind: "frontmatter", path: "X.md", previous: { tipo: "id", archivado: undefined } }]);
    expect(saved).toMatchObject({ journal: [{ effects: [{ kind: "frontmatter", previous: { tipo: "id" }, missingKeys: ["archivado"] }] }] });
  });

  it("checks a concurrent edit inside the atomic managed block undo callback", async () => {
    const v = new FakeObsidianVault();
    const file = v.file("JDex/index.md", "after");
    let concurrent = true;
    v.beforeWrite = (path) => { if (concurrent) v.bodies.set(path, "manual edit"); };
    const op = { kind: "fix" as const, label: "Index", at: "2026-10-05", effects: [
      { kind: "note-rewrite" as const, path: file.path, before: "before", after: "after" }
    ] };
    await expect(undoOperation(v.app, op)).rejects.toThrow("edited after updating");
    expect(v.bodies.get(file.path)).toBe("manual edit");
    expect(op.effects).toHaveLength(1);
    concurrent = false;
    v.bodies.set(file.path, "after");
    await undoOperation(v.app, op);
    expect(v.bodies.get(file.path)).toBe("before");
    expect(op.effects).toEqual([]);
  });

  it("creates structure notes only after opting in and uses the selected system's templates", async () => {
    const v = new FakeObsidianVault();
    for (const path of ["JDex", "20-29 Productos/21 Software", "D01.20-29 Trabajo/D01.21 Proyectos"]) v.folder(path);
    const bodies = v.bodies;
    const app = v.app;
    const settings = { ...DEFAULT_SETTINGS, jdexFolder: "JDex", systemRoot: "", templatesFolder: "" };
    const fix = { type: "create-note", path: "JDex/D01.20-29 Trabajo.md", number: "20-29", system: "D01", title: "Trabajo", kind: "area", category: "" } as const;
    await expect(applyFix(app, fix, [], settings)).rejects.toThrow("Activa");
    const enabled = { ...settings, structureNotesAreFindings: true };
    const effects: Effect[] = [];
    await applyFix(app, fix, effects, enabled);
    await applyFix(app, { type: "create-note", path: "JDex/D01.21 Proyectos.md", number: "21", system: "D01", title: "Proyectos", kind: "categoria", category: "21" }, effects, enabled);
    expect(bodies.get(fix.path)).toContain("tipo: area");
    expect(bodies.get("JDex/D01.21 Proyectos.md")).toContain("tipo: categoria");
    expect(bodies.get("JDex/D01.21 Proyectos.md")).toContain('area: "D01.20-29 Trabajo"');
    expect(effects).toHaveLength(2);
    await expect(applyFix(app, { ...fix, path: "JDex/D02.20-29 Trabajo.md", system: "D02" }, effects, enabled)).rejects.toThrow("categoría o área ausente");
  });

  it("keeps completed inverses persisted when a later inverse fails and retries only the remainder", async () => {
    const v = new FakeObsidianVault();
    v.folder("ID");
    const child = v.file("ID/kept.md");
    const restore = v.app.vault.create;
    const op = { kind: "fix" as const, label: "Reparar", at: "2026-10-05", effects: [
      { kind: "created-folder" as const, path: "ID" },
      { kind: "trashed-note" as const, path: "conflict.md", content: "idéntico" }
    ] };
    const persisted: Effect[][] = [];
    const progress = vi.fn(async () => { persisted.push([...op.effects]); });
    await expect(undoOperation(v.app, op, progress)).rejects.toThrow("not empty");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(v.exists("conflict.md")).toBe(true);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(op.effects).toEqual([{ kind: "created-folder", path: "ID" }]);
    expect(persisted).toEqual([[{ kind: "created-folder", path: "ID" }]]);
    await v.app.fileManager.trashFile(child); // the user empties the folder
    await undoOperation(v.app, op, progress);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(v.exists("ID")).toBe(false);
    expect(op.effects).toEqual([]);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(persisted.at(-1)).toEqual([]);
  });

  it("creates, moves and trashes guarded repairs, then undoes all effect types together", async () => {
    const v = new FakeObsidianVault();
    const { app, bodies } = v;
    const category = "20-29 Productos/21 Software";
    const dCategory = "D01.20-29 Productos/D01.21 Software";
    ["JDex", `${category}/21.01 Inbox`, `${category}/21.22 Proyecto`, `${dCategory}/D01.21.22 Proyecto/+ Hijo`].forEach((path) => v.folder(path));
    v.file(`${category}/21.02 Gestión/factura.pdf`, "PDF");
    v.file("JDex/21.24 X.md", "cuerpo igual");
    v.file("JDex/21.24 X (conflicted copy).md", "cuerpo igual");
    const settings = { ...DEFAULT_SETTINGS, jdexFolder: "JDex", systemRoot: "", templatesFolder: "" };
    const effects: Effect[] = [];
    await applyFix(app, { type: "create-note", path: "JDex/21.22 Proyecto.md", number: "21.22", title: "Proyecto", kind: "id", category: "21" }, effects, settings);
    await applyFix(app, { type: "create-note", path: "JDex/D01.21.22 Proyecto.md", number: "21.22", system: "D01", title: "Proyecto", kind: "id", category: "21" }, effects, settings);
    await applyFix(app, { type: "create-note", path: "JDex/D01.21.22+ Hijo.md", number: "21.22+", system: "D01", title: "Hijo", kind: "id", category: "21" }, effects, settings);
    expect(bodies.get("JDex/D01.21.22 Proyecto.md")).toContain('jd: "21.22"');
    expect(bodies.get("JDex/D01.21.22 Proyecto.md")).toContain('categoria: "D01.21 Software"');
    await applyFix(app, { type: "create-folder", path: `${category}/21.23 Nuevo`, paths: [`${category}/21.23 Nuevo`, `${category}/21.23 Nuevo/70 Adjuntos`] }, effects, settings);
    await applyFix(app, { type: "move", items: [{ from: `${category}/21.02 Gestión/factura.pdf`, to: `${category}/21.01 Inbox/factura.pdf` }] }, effects);
    await applyFix(app, { type: "trash", path: "JDex/21.24 X (conflicted copy).md", identicalTo: "JDex/21.24 X.md" }, effects);
    expect(effects.map((effect) => effect.kind)).toEqual(["created-note", "created-note", "created-note", "created-folder", "created-folder", "moved", "trashed-note"]);
    await undoOperation(app, { kind: "fix", label: "Reparar", at: "2026-10-05", effects });
    expect(v.exists("JDex/21.22 Proyecto.md")).toBe(false);
    expect(v.exists("JDex/D01.21.22 Proyecto.md")).toBe(false);
    expect(v.exists(`${category}/21.23 Nuevo`)).toBe(false);
    expect(v.exists(`${category}/21.02 Gestión/factura.pdf`)).toBe(true);
    expect(bodies.get("JDex/21.24 X (conflicted copy).md")).toBe("cuerpo igual");
  });

  it("keeps a description written manually after auditing and journals only unchanged fields", async () => {
    const path = "JDex/21.22 X.md";
    const fm: Record<string, unknown> = { jd: "wrong", descripcion: "" };
    const findings = auditSystem({
      index: buildIndex({ systemRoot: "", jdexFolder: "JDex", notePaths: [path], folderPaths: [] }),
      notes: [{ path, frontmatter: fm, body: "Descripción propuesta." }], filePaths: [path],
    });
    // After the audit: the description was written by hand and tipo changed elsewhere.
    const v = new FakeObsidianVault();
    v.file(path, '---\njd: wrong\ndescripcion: "Descripción manual posterior."\ntipo: archivado\n---\nDescripción propuesta.\n');
    const before = v.bodies.get(path);
    const effects: Effect[] = [];
    for (const finding of findings.filter((f) => f.fix?.type === "frontmatter")) await applyFix(v.app, finding.fix!, effects);
    const body = v.bodies.get(path)!;
    expect(body).toContain('descripcion: "Descripción manual posterior."');
    expect(body).toContain('jd: "21.22"');
    expect(body).toContain("tipo: archivado");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual({ kind: "note-rewrite", path, before, after: body });
    expect(notices().join(" ")).toContain("descripcion porque cambió desde la auditoría");
  });

  it("preselects only mechanical fields, leaving description, renames and folders unchecked", async () => {
    const findings: Finding[] = [
      { kind: "frontmatter-mismatch", paths: ["a.md"], message: "a", fix: { type: "frontmatter", path: "a.md", set: { jd: "21.22", tipo: "id", area: "20-29", categoria: "21" } } },
      { kind: "missing-description", paths: ["a.md"], message: "b", fix: { type: "frontmatter", path: "a.md", set: { descripcion: "Propuesta." } } },
      { kind: "name-mismatch", paths: ["a", "b"], message: "c", fix: { type: "rename", from: "a", to: "b" } },
      { kind: "pattern-missing", paths: ["a"], message: "d", fix: { type: "folders", paths: ["a/hijo"] } },
      { kind: "duplicate-id", paths: ["a", "b"], message: "e" },
      { kind: "folder-without-note", paths: ["a"], message: "f" },
      { kind: "structure-without-note", paths: ["area"], message: "g", fix: { type: "create-note", path: "JDex/20-29 Productos.md", number: "20-29", title: "Productos", kind: "area", category: "" } },
    ];
    const done = vi.fn(async () => {});
    const modal = new FixFindingsModal({} as App, findings, done);
    modal.open();
    // The preview groups by finding kind, so name-mismatch precedes frontmatter.
    expect(toggles().map((toggle) => toggle.value)).toEqual([false, true, false, false, false]);
    expect(buttons()[0]).toMatchObject({ text: 'Aplicar (1)', disabled: false });
    void toggles()[1].toggle();
    expect(buttons()[0]).toMatchObject({ text: 'Aplicar (0)', disabled: true });
    void buttons()[0].click(); // a disabled button does nothing
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(notices().join(' ')).not.toContain('Arreglos procesados');
    expect(modal.effects).toEqual([]);
  });

  it("enables a repair after explicit selection and writes the selected description", async () => {
    const path = 'JDex/21.22 X.md';
    const v = new FakeObsidianVault();
    v.file(path, '# 21.22 X\n');
    const write = v.app.vault.process;
    const finding: Finding = { kind: 'missing-description', paths: [path], message: 'Descripción.',
      fix: { type: 'frontmatter', path, set: { descripcion: 'Seleccionada.' } } };
    const done = vi.fn(async () => {});
    const modal = new FixFindingsModal(v.app, [finding], done);
    modal.open();
    expect(buttons()[0]).toMatchObject({ text: 'Aplicar (0)', disabled: true });
    void toggles()[0].toggle();
    expect(buttons()[0]).toMatchObject({ text: 'Aplicar (1)', disabled: false });
    void buttons()[0].click();
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(v.bodies.get(path)).toContain('descripcion: "Seleccionada."');
    expect(modal.effects).toHaveLength(1);
    expect(notices()).toContain('Arreglos procesados: 1; omitidos o fallidos: 0.');
    expect(isOpen(modal)).toBe(false);
  });

  it("reaudits before opening even with existing findings", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    plugin.lastFindings = [{ kind: "name-mismatch", paths: ["old"], message: "old", fix: { type: "rename", from: "old", to: "stale" } }];
    const audit = vi.spyOn(plugin, "audit").mockImplementation(async () => {
      plugin.lastFindings = [{ kind: "missing-description", paths: ["fresh.md"], message: "fresh", fix: { type: "frontmatter", path: "fresh.md", set: { descripcion: "Fresh." } } }];
    });
    await plugin.applyFixes();
    expect(audit).toHaveBeenCalledWith(false);
    expect(toggles().map((toggle) => toggle.value)).toEqual([false]);
  });

  it("does not reuse old findings when the fresh audit fails", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    plugin.lastFindings = [{ kind: "name-mismatch", paths: ["old"], message: "old", fix: { type: "rename", from: "old", to: "stale" } }];
    vi.spyOn(plugin, "audit").mockResolvedValue();
    await plugin.applyFixes();
    expect(toggles()).toEqual([]);
  });
});
