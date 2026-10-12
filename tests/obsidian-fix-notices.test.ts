/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Code review of 12 Oct 2026, finding 3: a frontmatter fix that is refused during automatic
 * maintenance warned with a 10 s Notice on every pass, outside the maintenance's once-per-session
 * notifier; and a fix that changes nothing still went through `vault.process` (a modify event that
 * could reopen maintenance).
 */
import { describe, expect, it, vi } from "vitest";
import { type App, Notice, TFile, TFolder } from "obsidian";
import { mergeSettings } from "../src/jd/settings";
import type { Effect } from "../src/jd/journal";
import { applyFix } from "../src/vault/audit";
import { maintainSystem } from "../src/vault/maintenance";
import { onceNotifier } from "../src/vault/maintenance-gate";
import { readFrontmatter } from "../src/vault/frontmatter-lines";

vi.mock("obsidian", async (importOriginal) => ({ ...(await importOriginal<typeof import("obsidian")>()), Notice: vi.fn() }));

// `jd` and `JD` are the same key for the line writer, so it refuses to patch this block.
const REFUSED = '---\ndescripcion: x\nJD: "99"\njd: "21.12"\n---\n# 21.11 Note\n';
const CORRECT = '---\njd: "21.11"\ntipo: "id"\narea: 20-29 Area\ncategoria: 21 Cat\ndescripcion: x\n---\n# 21.11 Note\n';

function fixture(body: string) {
  const folders = ["J", "20-29 Area", "20-29 Area/21 Cat"].map((path) => Object.assign(new TFolder(), { path }));
  const bodies = new Map([["J/21.11 Note.md", body]]);
  const files = [...bodies.keys()].map((path) => Object.assign(new TFile(), { path, name: path.split("/").pop(), basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md", parent: { path: "J" }, stat: { ctime: 1, mtime: 1 } }));
  const app = {
    vault: {
      getAllLoadedFiles: () => [...folders, ...files], getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => [...folders, ...files].find((file) => file.path === path) ?? null,
      read: async (file: TFile) => bodies.get(file.path)!, cachedRead: async (file: TFile) => bodies.get(file.path)!,
      process: vi.fn(async (file: TFile, transform: (current: string) => string) => { const next = transform(bodies.get(file.path)!); bodies.set(file.path, next); return next; }),
      create: vi.fn(),
    },
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: readFrontmatter(bodies.get(file.path) ?? "") ?? undefined }) },
    fileManager: { renameFile: vi.fn(), trashFile: vi.fn() },
  } as unknown as App;
  return { app, bodies, settings: mergeSettings({ jdexFolder: "J", automaticMaintenance: true }) };
}

const processedNote = (app: App) => vi.mocked(app.vault.process).mock.calls.filter(([file]) => file.path === "J/21.11 Note.md").length;

describe("A refused frontmatter fix during maintenance (finding 3)", () => {
  it("warns through the maintenance notifier, once per note and session, never with its own Notice", async () => {
    const { app, settings, bodies } = fixture(REFUSED);
    const shown = vi.fn();
    const warn = onceNotifier(shown);
    vi.mocked(Notice).mockClear();
    for (let pass = 0; pass < 3; pass += 1) await maintainSystem(app, settings, [], warn);
    expect(Notice).not.toHaveBeenCalled();
    const refusals = shown.mock.calls.filter(([message]) => String(message).includes("J/21.11 Note.md"));
    expect(refusals).toHaveLength(1);
    expect(bodies.get("J/21.11 Note.md")).toBe(REFUSED);
  });

  it("does not call vault.process on a note it refuses to patch", async () => {
    const { app, settings } = fixture(REFUSED);
    await maintainSystem(app, settings, [], () => {});
    expect(processedNote(app)).toBe(0);
  });

  it("control: a manual repair without a notifier still shows a Notice", async () => {
    const { app } = fixture(REFUSED);
    vi.mocked(Notice).mockClear();
    await applyFix(app, { type: "frontmatter", path: "J/21.11 Note.md", set: { jd: "21.11" } });
    expect(Notice).toHaveBeenCalledTimes(1);
  });
});

describe("A frontmatter fix that changes nothing (finding 3)", () => {
  it("does not call vault.process and records nothing", async () => {
    const { app } = fixture(CORRECT);
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: "J/21.11 Note.md", set: { jd: "21.11", tipo: "id" } }, effects);
    expect(processedNote(app)).toBe(0);
    expect(effects).toEqual([]);
  });

  it("control: a fix that changes a key writes through vault.process", async () => {
    const { app, bodies } = fixture(CORRECT);
    const effects: Effect[] = [];
    await applyFix(app, { type: "frontmatter", path: "J/21.11 Note.md", set: { tipo: "cabecera" } }, effects);
    expect(processedNote(app)).toBe(1);
    expect(bodies.get("J/21.11 Note.md")).toContain('tipo: "cabecera"');
    expect(effects).toHaveLength(1);
  });
});
