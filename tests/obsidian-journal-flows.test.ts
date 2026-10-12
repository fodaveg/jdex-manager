/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import type { Operation } from "../src/jd/journal";
import { mergeSettings } from "../src/jd/settings";
import { applyFix } from "../src/vault/audit";
import { scanVault } from "../src/vault/scan";
import { moveInto } from "../src/vault/files";
import { createId } from "../src/ui/create-id";
import { CreateCategoryModal } from "../src/ui/create-structure";
import { ProcessInboxModal } from "../src/ui/inbox";
import { PluginDataFile, UndoShield, undoLastOperation } from "../src/vault/journal-store";
import { MaintenanceGate, onceNotifier } from "../src/vault/maintenance-gate";
import { fakeVault, type FakeVault } from "./support/fake-obsidian-vault";

const ROOT_FOLDERS = ["J", "20-29 Area", "20-29 Area/21 Cat", "20-29 Area/21 Cat/21.01 Inbox", "20-29 Area/21 Cat/21.09 Archive"];

function vault(): FakeVault {
  const v = fakeVault();
  for (const path of ROOT_FOLDERS) v.folder(path);
  v.file("J/21.01 Inbox.md", "# 21.01 Inbox\n", { jd: "21.01", tipo: "id", area: "20-29 Area", categoria: "21 Cat" });
  v.file("J/21.09 Archive.md", "# 21.09 Archive\n", { jd: "21.09", tipo: "id", area: "20-29 Area", categoria: "21 Cat" });
  return v;
}

function store(v: FakeVault) {
  let stored: unknown = null;
  const io = { load: vi.fn(async (): Promise<unknown> => (stored === null ? null : JSON.parse(JSON.stringify(stored)) as unknown)), save: vi.fn(async (data: unknown) => { stored = JSON.parse(JSON.stringify(data)); }) };
  const settings = mergeSettings({ jdexFolder: "J" });
  const data = new PluginDataFile(io, settings, "dev-A");
  let now = 0;
  const shield = new UndoShield(1500, () => now);
  const undo = () => undoLastOperation({ app: v.app, data, shield, confirm: async () => true, notice: () => {}, setRenaming: () => {} });
  return { io, data, settings, shield, undo, tick: (ms: number) => { now += ms; } };
}

async function plugin(v: FakeVault, extra: Record<string, unknown> = {}) {
  let stored: unknown = { jdexFolder: "J", ...extra };
  let now = 0;
  const p = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
    app: v.app,
    settings: mergeSettings(null),
    renaming: false,
    maintenanceRunning: false,
    maintenanceTimer: null,
    maintenanceGate: new MaintenanceGate(),
    maintenanceWarn: onceNotifier(() => {}),
    indexCache: null,
    inboxBar: null,
    shield: new UndoShield(1500, () => now),
    loadData: async (): Promise<unknown> => JSON.parse(JSON.stringify(stored)) as unknown,
    saveData: vi.fn(async (data: unknown) => { stored = JSON.parse(JSON.stringify(data)); }),
  }) as unknown as JdexManagerPlugin;
  await p.loadSettings();
  const internals = p as unknown as { data: PluginDataFile; undoShield: UndoShield };
  return { p, data: internals.data, shield: internals.undoShield, tick: (ms: number) => { now += ms; }, saved: () => stored as { journal: Operation[] } };
}

describe("Every Obsidian write reaches the journal", () => {
  it("Create ID keeps the created note in the journal when creating its folder fails", async () => {
    const v = vault();
    const { data, undo } = store(v);
    await data.load();
    const index = scanVault(v.app, data.settings);
    const category = index.categories.find((c) => c.number === "21")!;
    vi.mocked(v.app.vault.createFolder).mockRejectedValueOnce(new Error("disk full"));
    const effects = data.journal.begin("create-id", "Create 21.11 New");
    await expect(createId(v.app, data.settings, index, category, { id: "21.11", title: "New", createFolder: true, createPattern: false }, effects)).rejects.toThrow("disk full");
    await effects.flush();
    expect(data.journal.entries.map((op) => op.effects.map((e) => e.kind))).toEqual([["created-note"]]);
    await undo();
    expect(v.exists("J/21.11 New.md")).toBe(false);
  });

  it("Create category with a failure at .09 lets undo remove everything it created", async () => {
    const v = vault();
    v.folder("20-29 Area/22 Other");
    const { data, undo } = store(v);
    await data.load();
    const index = scanVault(v.app, data.settings);
    const area = index.areas[0];
    const modal = new CreateCategoryModal(v.app, index, area, data.settings, async () => {}, data.journal.begin("create-structure", "Create category"));
    Object.assign(modal, { app: v.app, number: "23", title: "Nueva", toggles: { folder: true, inbox: true, archive: true } });
    const create = vi.mocked(v.app.vault.create);
    const original = create.getMockImplementation()!;
    create.mockImplementation(async (path: string, body: string) => {
      if (path.includes("23.09")) throw new Error("archive failed");
      return original(path, body);
    });
    await expect((modal as unknown as { perform(): Promise<TFile | null> }).perform()).rejects.toThrow("archive failed");
    const op = data.journal.last()!;
    expect(op.effects.map((e) => e.kind)).toEqual(["created-note", "created-folder", "created-note", "created-folder"]);
    await undo();
    expect(v.exists("J/23 Nueva.md")).toBe(false);
    expect(v.exists("20-29 Area/23 Nueva")).toBe(false);
    expect(data.journal.entries).toEqual([]);
  });

  it("a three-step repair saves data.json once per step and undoes as one operation", async () => {
    const v = vault();
    v.file("J/21.11 X.md", "# 21.11 X\n", { jd: "wrong" });
    v.file("20-29 Area/21 Cat/21.01 Inbox/a.pdf", "pdf");
    const { data, io, undo } = store(v);
    await data.load();
    const effects = data.journal.begin("fix", "Reparar JDex");
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 X.md", set: { jd: "21.11" } }, effects);
    await applyFix(v.app, { type: "create-folder", path: "20-29 Area/21 Cat/21.11 X", paths: ["20-29 Area/21 Cat/21.11 X"] } as never, effects);
    await applyFix(v.app, { type: "move", items: [{ from: "20-29 Area/21 Cat/21.01 Inbox/a.pdf", to: "20-29 Area/21 Cat/21.11 X/a.pdf" }] } as never, effects);
    await effects.flush();
    expect(io.save).toHaveBeenCalledTimes(3);
    await undo();
    expect(v.frontmatter.get("J/21.11 X.md")).toEqual({ jd: "wrong" });
    expect(v.exists("20-29 Area/21 Cat/21.01 Inbox/a.pdf")).toBe(true);
    expect(v.exists("20-29 Area/21 Cat/21.11 X")).toBe(false);
  });

  it("processing the inbox journals each move and each Markdown deletion", async () => {
    const v = vault();
    const pdf = v.file("20-29 Area/21 Cat/21.01 Inbox/a.pdf", "pdf");
    const { data, undo } = store(v);
    await data.load();
    const index = scanVault(v.app, data.settings);
    const modal = new ProcessInboxModal(v.app, [pdf], { index, systemRoot: "", dateFormat: "YYYY-MM-DD", journal: (kind, label) => data.journal.begin(kind, label) }, async () => {});
    const recordMove = (modal as unknown as { recordMove(file: TFile, label: string, move: () => Promise<string>): Promise<string> }).recordMove.bind(modal);
    await recordMove(pdf, "Archive a.pdf", () => moveInto(v.app, pdf, "20-29 Area/21 Cat/21.09 Archive"));
    expect(data.journal.last()).toMatchObject({ label: "Archive a.pdf", effects: [{ kind: "moved", type: "file" }] });
    await undo();
    expect(v.exists("20-29 Area/21 Cat/21.01 Inbox/a.pdf")).toBe(true);
  });

  it("dating a file and updating header lists and the index are journaled and undoable", async () => {
    const v = vault();
    v.folder("20-29 Area/21 Cat/21.11 Note");
    v.file("J/21.11 Note.md", "# 21.11 Note\n", { jd: "21.11", tipo: "id" });
    v.file("J/21.10 ■ Header.md", "# 21.10 ■ Header\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n", { jd: "21.10", tipo: "cabecera" });
    const doc = v.file("20-29 Area/21 Cat/21.11 Note/doc.pdf", "pdf");
    const { p, data } = await plugin(v);
    await p.dateActive(doc);
    expect(data.journal.last()?.label).toBe("Date doc.pdf");
    await p.refreshHeaders(undefined, false);
    expect(data.journal.last()).toMatchObject({ label: "Update header lists", effects: [{ kind: "note-rewrite", path: "J/21.10 ■ Header.md" }] });
    const undo = () => undoLastOperation({ app: v.app, data, shield: new UndoShield(), confirm: async () => true, notice: () => {}, setRenaming: () => {} });
    await undo();
    expect(v.bodies.get("J/21.10 ■ Header.md")).not.toContain("[[21.11 Note]]");
    await undo();
    expect(v.exists("20-29 Area/21 Cat/21.11 Note/doc.pdf")).toBe(true);
    expect(data.journal.entries).toEqual([]);
  });

  it("renaming the pair partner is journaled with the identity of the folder", async () => {
    const v = vault();
    v.folder("20-29 Area/21 Cat/21.11 Old");
    const note = v.file("J/21.11 Old.md", "# 21.11 Old\n", { jd: "21.11", tipo: "id" });
    const { p, data } = await plugin(v, { renamePairsWithoutAsking: true });
    await v.app.fileManager.renameFile(note, "J/21.11 New.md");
    await p.onRename(note, "J/21.11 Old.md");
    expect(v.exists("20-29 Area/21 Cat/21.11 New")).toBe(true);
    expect(data.journal.last()).toMatchObject({ effects: [{ kind: "moved", from: "20-29 Area/21 Cat/21.11 Old", to: "20-29 Area/21 Cat/21.11 New", type: "folder" }] });
  });
});

describe("Undo is not redone by automatic writes", () => {
  function normalizeSetup() {
    const v = vault();
    v.file("J/21.11 Note.md", "# 21.11 Note\n", { jd: "wrong", tipo: "id", area: "20-29 Area", categoria: "21 Cat" });
    v.file("J/21.12 Other.md", "# 21.12 Other\n", { jd: "bad", tipo: "id", area: "20-29 Area", categoria: "21 Cat" });
    return v;
  }

  it("after undoing Normalize, later events and maintenance leave the restored note alone", async () => {
    const v = normalizeSetup();
    const { p, data, shield, tick } = await plugin(v, { automaticMaintenance: true });
    const effects = (p as unknown as { journalOperation(kind: string, label: string): never[] }).journalOperation("fix", "Normalize JDex frontmatter");
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 Note.md", set: { jd: "21.11" } }, effects);
    // The command's `confirm` needs the DOM; the test runs the routine it calls.
    await undoLastOperation({ app: v.app, data, shield, confirm: async () => true, notice: () => {}, setRenaming: () => {} });
    expect(v.frontmatter.get("J/21.11 Note.md")).toMatchObject({ jd: "wrong" });
    const entries = data.journal.entries.length;
    const restored = v.app.vault.getAbstractFileByPath("J/21.11 Note.md");
    if (!(restored instanceof TFile)) throw new Error("missing note");
    (p as unknown as { queueMaintenance(file: TFile): void }).queueMaintenance(restored);
    expect((p as unknown as { maintenanceTimer: unknown }).maintenanceTimer).toBeNull();
    await p.maintainAutomatically();
    expect(v.frontmatter.get("J/21.11 Note.md")).toMatchObject({ jd: "wrong" });
    // Maintenance still fixes notes the undo did not touch, in its own operation.
    expect(v.frontmatter.get("J/21.12 Other.md")).toMatchObject({ jd: "21.12" });
    expect(data.journal.entries.length).toBe(entries + 1);
    expect(data.journal.last()!.effects.every((e) => !("path" in e) || e.path !== "J/21.11 Note.md")).toBe(true);
    // A real edit after the undo settled lifts the protection (control).
    tick(2000);
    shield.observe("J/21.11 Note.md");
    await p.maintainAutomatically();
    expect(v.frontmatter.get("J/21.11 Note.md")).toMatchObject({ jd: "21.11" });
  });

  it("maintenance injected in the middle of a two-step undo waits and does not redo it", async () => {
    const v = normalizeSetup();
    const { p, data, shield } = await plugin(v, { automaticMaintenance: true });
    const effects = (p as unknown as { journalOperation(kind: string, label: string): never[] }).journalOperation("fix", "Normalize JDex frontmatter");
    await applyFix(v.app, { type: "frontmatter", path: "J/21.11 Note.md", set: { jd: "21.11" } }, effects);
    await applyFix(v.app, { type: "frontmatter", path: "J/21.12 Other.md", set: { jd: "21.12" } }, effects);
    const injected: { run: Promise<void> | null } = { run: null };
    v.beforeWrite = () => {
      injected.run ??= p.maintainAutomatically();
    };
    await undoLastOperation({ app: v.app, data, shield, confirm: async () => true, notice: () => {}, setRenaming: () => {} });
    v.beforeWrite = null;
    expect(injected.run).not.toBeNull();
    await injected.run;
    expect(v.frontmatter.get("J/21.11 Note.md")).toMatchObject({ jd: "wrong" });
    expect(v.frontmatter.get("J/21.12 Other.md")).toMatchObject({ jd: "bad" });
    expect(data.journal.entries).toEqual([]);
  });

  it("does not regenerate header lists after undo, so two undos reach the earlier operation", async () => {
    const v = vault();
    v.file("J/21.10 ■ Header.md", "# 21.10 ■ Header\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n", { jd: "21.10", tipo: "cabecera" });
    const { p, data, shield } = await plugin(v);
    const created = (p as unknown as { journalOperation(kind: string, label: string): { push(...e: unknown[]): number } }).journalOperation("create-id", "Create 21.11 Note");
    v.file("J/21.11 Note.md", "# 21.11 Note\n", { jd: "21.11", tipo: "id" });
    created.push({ kind: "created-note", path: "J/21.11 Note.md", content: v.bodies.get("J/21.11 Note.md")! });
    await p.refreshHeaders(undefined, false);
    expect(data.journal.entries.map((op) => op.label)).toEqual(["Create 21.11 Note", "Update header lists"]);
    const undo = () => undoLastOperation({ app: v.app, data, shield, confirm: async () => true, notice: () => {}, setRenaming: () => {} });
    await undo();
    await p.refreshHeaders(undefined, false);
    expect(v.bodies.get("J/21.10 ■ Header.md")).not.toContain("[[21.11 Note]]");
    expect(data.journal.entries.map((op) => op.label)).toEqual(["Create 21.11 Note"]);
    await undo();
    expect(v.exists("J/21.11 Note.md")).toBe(false);
    expect(data.journal.entries).toEqual([]);
  });
});
