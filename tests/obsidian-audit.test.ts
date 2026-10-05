import { beforeEach, describe, expect, it, vi } from "vitest";
import { type App, type PluginManifest, TFile, TFolder } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { auditSystem, type Finding } from "../src/jd/audit";
import { buildIndex } from "../src/jd/index";
import type { Effect, Operation } from "../src/jd/journal";
import { DEFAULT_SETTINGS } from "../src/settings";
import { applyFix } from "../src/vault/audit";
import { undoOperation } from "../src/vault/journal";
import { FixFindingsModal } from "../src/ui/audit";

const ui = vi.hoisted(() => ({
  toggles: [] as { value: boolean; change?: (value: boolean) => void }[],
  buttons: [] as { text: string; disabled: boolean; click?: () => void }[],
  messages: [] as string[],
}));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Modal: class {
      contentEl = { empty() {}, createEl() { return { textContent: '' }; } };
      constructor(readonly app: App) {}
      setTitle() {}
      open() { (this as unknown as { onOpen(): void }).onOpen(); }
      close() {}
    },
    Setting: class {
      setName() { return this; }
      setDesc() { return this; }
      addToggle(build: (toggle: unknown) => void) {
        const state = { value: false } as (typeof ui.toggles)[number];
        ui.toggles.push(state);
        const toggle = { setValue(value: boolean) { state.value = value; return toggle; }, onChange(fn: (value: boolean) => void) { state.change = fn; return toggle; } };
        build(toggle);
        return this;
      }
      addButton(build: (button: unknown) => void) {
        const state = { text: '', disabled: false } as (typeof ui.buttons)[number];
        ui.buttons.push(state);
        const button = { setButtonText(text: string) { state.text = text; return button; }, setDisabled(disabled: boolean) { state.disabled = disabled; return button; }, setCta() { return button; }, onClick(fn: () => void) { state.click = fn; return button; } };
        build(button);
        return this;
      }
    },
    Notice: class { constructor(message: string) { ui.messages.push(message); } },
  };
});

beforeEach(() => {
  ui.toggles.length = 0;
  ui.buttons.length = 0;
  ui.messages.length = 0;
});

describe("Obsidian audit fixes", () => {
  it("removes originally absent frontmatter after a repair journal survives JSON storage", async () => {
    const file = Object.assign(new TFile(), { path: "JDex/21.22 X.md" });
    const fm: Record<string, unknown> = { descripcion: "Texto existente", area: null };
    const app = { vault: { getAbstractFileByPath: () => file },
      fileManager: { processFrontMatter: async (_file: TFile, write: (value: Record<string, unknown>) => void) => { write(fm); } } } as unknown as App;
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: file.path, set: { jd: "21.22", tipo: "id", area: "20-29", categoria: "21" } }, effects);
    const reloaded = JSON.parse(JSON.stringify({ kind: "fix", label: "Reparar", at: "2026-10-05", effects })) as Operation;
    await undoOperation(app, reloaded);
    expect(fm).toEqual({ descripcion: "Texto existente", area: null });
    expect(fm).not.toHaveProperty("jd");
    expect(fm).not.toHaveProperty("tipo");
    expect(fm).not.toHaveProperty("categoria");
  });

  it("normalizes every frontmatter writer before saving the Obsidian journal", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    let saved: unknown;
    Object.assign(plugin, { saveData: vi.fn(async (data: unknown) => { saved = JSON.parse(JSON.stringify(data)); }) });
    await plugin.record("retire", "Retirar", [{ kind: "frontmatter", path: "X.md", previous: { tipo: "id", archivado: undefined } }]);
    expect(saved).toMatchObject({ journal: [{ effects: [{ kind: "frontmatter", previous: { tipo: "id" }, missingKeys: ["archivado"] }] }] });
  });

  it("checks a concurrent edit inside the atomic managed block undo callback", async () => {
    const file = Object.assign(new TFile(), { path: "JDex/index.md" });
    let body = "after";
    let concurrent = true;
    const app = { vault: { getAbstractFileByPath: () => file,
      process: async (_file: TFile, update: (current: string) => string) => {
        if (concurrent) body = "manual edit";
        body = update(body);
        return body;
      } } } as unknown as App;
    const op = { kind: "fix" as const, label: "Index", at: "2026-10-05", effects: [
      { kind: "note-rewrite" as const, path: file.path, before: "before", after: "after" }
    ] };
    await expect(undoOperation(app, op)).rejects.toThrow("edited after updating");
    expect(body).toBe("manual edit");
    expect(op.effects).toHaveLength(1);
    concurrent = false;
    body = "after";
    await undoOperation(app, op);
    expect(body).toBe("before");
    expect(op.effects).toEqual([]);
  });

  it("creates structure notes only after opting in and uses the selected system's templates", async () => {
    const folders = ["JDex", "20-29 Productos", "20-29 Productos/21 Software", "D01.20-29 Trabajo", "D01.20-29 Trabajo/D01.21 Proyectos"]
      .map((path) => Object.assign(new TFolder(), { path }));
    const bodies = new Map<string, string>();
    const app = { vault: {
      getAllLoadedFiles: () => folders,
      getMarkdownFiles: () => [],
      getAbstractFileByPath: (path: string) => folders.find((folder) => folder.path === path),
      create: async (path: string, body: string) => { bodies.set(path, body); }
    } } as unknown as App;
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
    const folder = Object.assign(new TFolder(), { path: "ID", children: [new TFile()] });
    const entries = new Map<string, TFile | TFolder>([[folder.path, folder]]);
    const restore = vi.fn(async (path: string) => {
      const restored = Object.assign(new TFile(), { path });
      entries.set(path, restored);
      return restored;
    });
    const app = { vault: { getAbstractFileByPath: (path: string) => entries.get(path), create: restore },
      fileManager: { trashFile: async (entry: TFolder) => { entries.delete(entry.path); } } } as unknown as App;
    const op = { kind: "fix" as const, label: "Reparar", at: "2026-10-05", effects: [
      { kind: "created-folder" as const, path: "ID" },
      { kind: "trashed-note" as const, path: "conflict.md", content: "idéntico" }
    ] };
    const persisted: Effect[][] = [];
    const progress = vi.fn(async () => { persisted.push([...op.effects]); });
    await expect(undoOperation(app, op, progress)).rejects.toThrow("not empty");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(op.effects).toEqual([{ kind: "created-folder", path: "ID" }]);
    expect(persisted).toEqual([[{ kind: "created-folder", path: "ID" }]]);
    folder.children.length = 0;
    await undoOperation(app, op, progress);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(op.effects).toEqual([]);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(persisted.at(-1)).toEqual([]);
  });

  it("creates, moves and trashes guarded repairs, then undoes all effect types together", async () => {
    const entries = new Map<string, TFile | TFolder>();
    const bodies = new Map<string, string>();
    const folder = (path: string) => {
      const item = Object.assign(new TFolder(), { path, children: [] });
      entries.set(path, item);
      return item;
    };
    const file = (path: string, body: string) => {
      const item = Object.assign(new TFile(), { path, extension: path.slice(path.lastIndexOf(".") + 1) });
      entries.set(path, item);
      bodies.set(path, body);
      return item;
    };
    const category = "20-29 Productos/21 Software";
    const dCategory = "D01.20-29 Productos/D01.21 Software";
    ["JDex", "20-29 Productos", category, `${category}/21.01 Inbox`, `${category}/21.22 Proyecto`,
      "D01.20-29 Productos", dCategory, `${dCategory}/D01.21.22 Proyecto`, `${dCategory}/D01.21.22 Proyecto/+ Hijo`].forEach(folder);
    file(`${category}/21.02 Gestión/factura.pdf`, "PDF");
    file("JDex/21.24 X.md", "cuerpo igual");
    file("JDex/21.24 X (conflicted copy).md", "cuerpo igual");
    const app = { vault: {
      getAllLoadedFiles: () => [...entries.values()],
      getAbstractFileByPath: (path: string) => entries.get(path),
      getMarkdownFiles: () => [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile && entry.extension === "md"),
      read: async (entry: TFile) => bodies.get(entry.path)!,
      createFolder: async (path: string) => folder(path),
      create: async (path: string, body: string) => file(path, body),
    }, fileManager: {
      renameFile: async (entry: TFile | TFolder, to: string) => {
        const body = bodies.get(entry.path);
        entries.delete(entry.path);
        bodies.delete(entry.path);
        entry.path = to;
        entries.set(to, entry);
        if (body !== undefined) bodies.set(to, body);
      },
      trashFile: async (entry: TFile | TFolder) => { entries.delete(entry.path); bodies.delete(entry.path); },
    } } as unknown as App;
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
    expect(entries.has("JDex/21.22 Proyecto.md")).toBe(false);
    expect(entries.has("JDex/D01.21.22 Proyecto.md")).toBe(false);
    expect(entries.has(`${category}/21.23 Nuevo`)).toBe(false);
    expect(entries.has(`${category}/21.02 Gestión/factura.pdf`)).toBe(true);
    expect(bodies.get("JDex/21.24 X (conflicted copy).md")).toBe("cuerpo igual");
  });

  it("keeps a description written manually after auditing and journals only unchanged fields", async () => {
    const path = "JDex/21.22 X.md";
    const fm: Record<string, unknown> = { jd: "wrong", descripcion: "" };
    const findings = auditSystem({
      index: buildIndex({ systemRoot: "", jdexFolder: "JDex", notePaths: [path], folderPaths: [] }),
      notes: [{ path, frontmatter: fm, body: "Descripción propuesta." }], filePaths: [path],
    });
    const file = Object.assign(new TFile(), { path });
    const cachedFrontmatter = { ...fm };
    const app = {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: { getFileCache: () => ({ frontmatter: cachedFrontmatter }) },
      fileManager: { processFrontMatter: async (_file: TFile, write: (current: Record<string, unknown>) => void) => {
        fm.tipo = "archivado";
        write(fm);
      } },
    } as unknown as App;
    fm.descripcion = "Descripción manual posterior.";
    const effects: Effect[] = [];
    for (const finding of findings.filter((f) => f.fix?.type === "frontmatter")) await applyFix(app, finding.fix!, effects);
    expect(fm.descripcion).toBe("Descripción manual posterior.");
    expect(fm.jd).toBe("21.22");
    expect(fm.tipo).toBe("archivado");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual({ kind: "frontmatter", path, previous: { jd: "wrong" } });
    expect(ui.messages.join(" ")).toContain("descripcion porque cambió desde la auditoría");
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
    expect(ui.toggles.map((toggle) => toggle.value)).toEqual([false, true, false, false, false]);
    expect(ui.buttons[0]).toMatchObject({ text: 'Aplicar (1)', disabled: false });
    ui.toggles[1].change?.(false);
    expect(ui.buttons[0]).toMatchObject({ text: 'Aplicar (0)', disabled: true });
    ui.buttons[0].click?.();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(ui.messages.join(' ')).toContain('Selecciona');
    expect(ui.messages.join(' ')).not.toContain('Arreglos procesados');
    expect(modal.effects).toEqual([]);
  });

  it("enables a repair after explicit selection and writes the selected description", async () => {
    const path = 'JDex/21.22 X.md';
    const file = Object.assign(new TFile(), { path });
    const fm: Record<string, unknown> = {};
    const write = vi.fn(async (_file: TFile, update: (current: Record<string, unknown>) => void) => update(fm));
    const app = { vault: { getAbstractFileByPath: () => file }, fileManager: { processFrontMatter: write } } as unknown as App;
    const finding: Finding = { kind: 'missing-description', paths: [path], message: 'Descripción.',
      fix: { type: 'frontmatter', path, set: { descripcion: 'Seleccionada.' } } };
    const done = vi.fn(async () => {});
    const modal = new FixFindingsModal(app, [finding], done);
    modal.open();
    expect(ui.buttons[0]).toMatchObject({ text: 'Aplicar (0)', disabled: true });
    ui.toggles[0].change?.(true);
    expect(ui.buttons[0]).toMatchObject({ text: 'Aplicar (1)', disabled: false });
    ui.buttons[0].click?.();
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    expect(fm.descripcion).toBe('Seleccionada.');
    expect(modal.effects).toHaveLength(1);
    expect(ui.messages).toContain('Arreglos procesados: 1; omitidos o fallidos: 0.');
  });

  it("reaudits before opening even with existing findings", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    plugin.lastFindings = [{ kind: "name-mismatch", paths: ["old"], message: "old", fix: { type: "rename", from: "old", to: "stale" } }];
    const audit = vi.spyOn(plugin, "audit").mockImplementation(async () => {
      plugin.lastFindings = [{ kind: "missing-description", paths: ["fresh.md"], message: "fresh", fix: { type: "frontmatter", path: "fresh.md", set: { descripcion: "Fresh." } } }];
    });
    await plugin.applyFixes();
    expect(audit).toHaveBeenCalledWith(false);
    expect(ui.toggles.map((toggle) => toggle.value)).toEqual([false]);
  });

  it("does not reuse old findings when the fresh audit fails", async () => {
    const plugin = new JdexManagerPlugin({} as App, {} as PluginManifest);
    plugin.lastFindings = [{ kind: "name-mismatch", paths: ["old"], message: "old", fix: { type: "rename", from: "old", to: "stale" } }];
    vi.spyOn(plugin, "audit").mockResolvedValue();
    await plugin.applyFixes();
    expect(ui.toggles).toEqual([]);
  });
});
