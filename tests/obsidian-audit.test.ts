import { beforeEach, describe, expect, it, vi } from "vitest";
import { type App, type PluginManifest, TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { auditSystem, type Finding } from "../src/jd/audit";
import { buildIndex } from "../src/jd/index";
import type { Effect } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { FixFindingsModal } from "../src/ui/audit";

const ui = vi.hoisted(() => ({
  toggles: [] as { value: boolean; change?: (value: boolean) => void }[],
  buttons: [] as (() => void)[],
  messages: [] as string[],
}));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Modal: class {
      contentEl = { empty() {}, createEl() {} };
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
        const button = { setButtonText() { return button; }, setCta() { return button; }, onClick(fn: () => void) { ui.buttons.push(fn); return button; } };
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
    ];
    const done = vi.fn(async () => {});
    const modal = new FixFindingsModal({} as App, findings, done);
    modal.open();
    // The preview groups by finding kind, so name-mismatch precedes frontmatter.
    expect(ui.toggles.map((toggle) => toggle.value)).toEqual([false, true, false, false]);
    ui.toggles[1].change?.(false);
    ui.buttons[0]();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(modal.effects).toEqual([]);
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
