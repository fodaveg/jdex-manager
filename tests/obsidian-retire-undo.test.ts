// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
/*
 * Retire -> undo round trip on the shared vault double, from `retireId` + `undoOperation` up to the
 * plugin flow (`retireFlow` -> journal on disk -> `undoLastOperation`). A retirement never renumbers
 * or reuses an ID, and its undo must give back the exact note text and the folder where it was.
 * The JDex note lives outside the ID folder (J/ vs the category), and src/vault/retire.ts keeps its path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/jd/index";
import type { Effect, Operation } from "../src/jd/journal";
import { mergeSettings } from "../src/settings";
import JdexManagerPlugin from "../src/main";
import { undoOperation } from "../src/vault/journal";
import { MaintenanceGate, onceNotifier } from "../src/vault/maintenance-gate";
import { PluginDataFile, UndoShield, undoLastOperation } from "../src/vault/journal-store";
import { retireId } from "../src/vault/retire";
import { scanVault } from "../src/vault/scan";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { notices, resetStub } from "./support/obsidian-stub-api";

vi.mock("../src/ui/confirm", () => ({ confirm: vi.fn(async () => true) }));
afterEach(() => resetStub());

const NOTE = "J/21.11 Note.md";
const FOLDER = "20-29 Area/21 Cat/21.11 Note";
const ARCHIVE = "20-29 Area/21 Cat/21.09 Archive";
const BODY = "---\n# my comment\njd: 21.20\ntipo: 'id'   # by hand\ndescripcion: Mine\n---\n# 21.11 Note\n\nBody.\n";
const op = (effects: Effect[]): Operation => ({ kind: "retire", label: "Retire 21.11", at: "2026-10-12T10:00:00.000Z", effects });

function setup() {
  const v = new FakeObsidianVault({ forbidProcessFrontMatter: true });
  v.folder("J");
  v.folder(FOLDER);
  v.folder(ARCHIVE);
  v.folder(`${FOLDER}/70 Attachments`);
  v.file(NOTE, BODY);
  v.file(`${FOLDER}/doc.pdf`, "pdf", undefined, 7);
  v.file(`${FOLDER}/70 Attachments/scan.png`, "png");
  v.file("J/21.12 Other.md", "---\ntipo: id\n---\n# 21.12 Other\n");
  const index = scanVault(v.app, mergeSettings({ jdexFolder: "J" }));
  return { v, index, entry: index.ids.find((e) => e.id === "21.11")! };
}

/** Everything observable in the vault: every path with its text, folders included. */
const snapshot = (v: FakeObsidianVault) => ({
  nodes: v.app.vault.getAllLoadedFiles().map((n) => n.path).sort(),
  bodies: [...v.bodies].sort(([a], [b]) => a.localeCompare(b)),
});

describe("retire then undo: the exact state comes back", () => {
  it("restores note text, folder path and contents byte for byte, and never renumbers the ID", async () => {
    const { v, index, entry } = setup();
    const before = snapshot(v);
    const idsBefore = index.ids.map((e) => [e.id, e.notePath, e.folderPath]);
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);

    // While retired: the note stays at its path, marked; the folder is in the archive; the ID is still 21.11.
    expect(v.exists(NOTE)).toBe(true);
    expect(v.frontmatter.get(NOTE)).toMatchObject({ tipo: "archivado" });
    expect(v.exists(FOLDER)).toBe(false);
    const retired = scanVault(v.app, mergeSettings({ jdexFolder: "J" }));
    expect(retired.ids.filter((e) => e.id === "21.11")).toHaveLength(1);
    expect(retired.ids.some((e) => e.id === "21.13")).toBe(false);

    const operation = op(effects);
    const done = await undoOperation(v.app, operation);
    expect(done).toHaveLength(3);
    expect(operation.effects).toEqual([]);
    expect(snapshot(v)).toEqual(before);
    expect(v.bodies.get(NOTE)).toBe(BODY); // comments, quoting and `jd: 21.20` untouched
    expect(v.app.vault.getAbstractFileByPath(`${FOLDER}/doc.pdf`)).toMatchObject({ stat: { ctime: 7 } });
    const after = scanVault(v.app, mergeSettings({ jdexFolder: "J" }));
    expect(after.ids.map((e) => [e.id, e.notePath, e.folderPath])).toEqual(idsBefore);
    expect(v.trashed).toEqual([]);
    expect(v.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });

  it("survives the journal's trip through JSON, as it does on disk", async () => {
    const { v, index, entry } = setup();
    const before = snapshot(v);
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    const stored = JSON.parse(JSON.stringify(op(effects))) as Operation;
    await undoOperation(v.app, stored);
    expect(snapshot(v)).toEqual(before);
  });

  it("an ID without folder: the note is marked and undo restores it", async () => {
    const v = new FakeObsidianVault();
    v.folder("J");
    v.folder("20-29 Area/21 Cat/21.09 Archive");
    v.file(NOTE, BODY);
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", notePaths: [NOTE], folderPaths: ["20-29 Area", "20-29 Area/21 Cat", ARCHIVE] });
    const effects: Effect[] = [];
    const notes = await retireId(v.app, index, index.ids.find((e) => e.id === "21.11")!, undefined, effects);
    expect(effects.map((e) => e.kind)).toEqual(["note-rewrite", "line"]);
    expect(notes.join(" ")).toContain("marked as retired");
    await undoOperation(v.app, op(effects));
    expect(v.bodies.get(NOTE)).toBe(BODY);
  });
});

describe("retire then undo: partial failures", () => {
  it("a failed move leaves the folder and restores the frontmatter on undo", async () => {
    const { v, index, entry } = setup();
    const before = snapshot(v);
    vi.mocked(v.app.fileManager.renameFile).mockRejectedValueOnce(new Error("Move failed"));
    const effects: Effect[] = [];
    await expect(retireId(v.app, index, entry, undefined, effects)).rejects.toThrow("Move failed");
    expect(effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
    expect(v.frontmatter.get(NOTE)).toMatchObject({ tipo: "archivado" });
    expect(v.exists(FOLDER)).toBe(true);
    await undoOperation(v.app, op(effects));
    expect(snapshot(v)).toEqual(before);
    expect(v.bodies.get(NOTE)).toBe(BODY);
  });

  it("refuses a note that was retired already, before touching anything", async () => {
    const { v, index, entry } = setup();
    await retireId(v.app, index, entry, undefined, []);
    const after = snapshot(v);
    const effects: Effect[] = [];
    // A stale index still lists the folder at its old path: the live note says it is retired.
    await expect(retireId(v.app, index, entry, undefined, effects)).rejects.toThrow("Ya retirado el");
    expect(snapshot(v)).toEqual(after);
    expect(effects).toEqual([]);
  });

  it("the destination already existing stops the retirement after the frontmatter, and undo restores it", async () => {
    const { v, index, entry } = setup();
    const before = snapshot(v);
    const date = new Date();
    const name = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} 21.11 Note`;
    v.folder(`${ARCHIVE}/${name}`);
    const taken = snapshot(v);
    const effects: Effect[] = [];
    await expect(retireId(v.app, index, entry, undefined, effects)).rejects.toThrow("already exists");
    expect(v.exists(FOLDER)).toBe(true);
    expect(effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
    await undoOperation(v.app, op(effects));
    expect(snapshot(v)).toEqual(taken);
    expect(taken.nodes.length).toBe(before.nodes.length + 1);
    expect(v.bodies.get(NOTE)).toBe(BODY);
  });
});

describe("retire then undo: edits made after the retirement", () => {
  it("refuses to overwrite a frontmatter edited by hand, keeps the step and leaves the user's text", async () => {
    const { v, index, entry } = setup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    v.setFm(NOTE, "descripcion", "Rewritten after retiring");
    const operation = op(effects);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("edited after");
    // The later steps were undone first (line, folder); the frontmatter rewrite is what is left.
    expect(operation.effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
    expect(v.exists(FOLDER)).toBe(true);
    expect(v.frontmatter.get(NOTE)).toMatchObject({ tipo: "archivado", descripcion: "Rewritten after retiring" });
  });

  it("text typed into the body after retiring also stops the frontmatter step, and nothing is lost", async () => {
    const { v, index, entry } = setup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    v.bodies.set(NOTE, `${v.bodies.get(NOTE)!}\nAdded later.\n`);
    const operation = op(effects);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("edited after");
    expect(v.bodies.get(NOTE)).toContain("Added later.");
    expect(operation.effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
  });

  it("does not move back a folder that is no longer where the retirement left it", async () => {
    const { v, index, entry } = setup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    const moved = effects.find((e) => e.kind === "moved") as { to: string };
    await v.app.fileManager.renameFile(v.app.vault.getAbstractFileByPath(moved.to)!, `${ARCHIVE}/renamed by me`);
    const operation = op(effects);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("not there any more");
    expect(operation.effects.map((e) => e.kind)).toEqual(["note-rewrite", "moved"]);
    expect(v.exists(`${ARCHIVE}/renamed by me/doc.pdf`)).toBe(true);
    expect(v.exists(FOLDER)).toBe(false);
  });

  it("does not move back onto a folder somebody created at the original path", async () => {
    const { v, index, entry } = setup();
    const effects: Effect[] = [];
    await retireId(v.app, index, entry, undefined, effects);
    v.folder(FOLDER);
    const operation = op(effects);
    await expect(undoOperation(v.app, operation)).rejects.toThrow("exists again");
    expect(operation.effects.map((e) => e.kind)).toEqual(["note-rewrite", "moved"]);
    expect(v.exists(`${FOLDER}/doc.pdf`)).toBe(false);
  });
});

/** The plugin with the real journal: a retirement from the command, undone from the journal on disk. */
async function pluginFor(v: FakeObsidianVault) {
  let stored: unknown = { jdexFolder: "J" };
  const now = 0;
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
  const data = (p as unknown as { data: PluginDataFile }).data;
  const said: string[] = [];
  const undo = () => undoLastOperation({ app: v.app, data, shield: new UndoShield(), confirm: async () => true, notice: (message) => void said.push(message), setRenaming: () => {} });
  return { p, data, undo, said, saved: () => stored as { journal: Operation[] } };
}

describe("retire then undo through the plugin and its saved journal", () => {
  it("retireFlow journals one operation on disk and undo restores the vault", async () => {
    const { v, entry } = setup();
    const before = snapshot(v);
    const { p, data, undo, saved } = await pluginFor(v);
    await p.retireFlow(entry);
    expect(notices().join(" ")).toContain("21.11 marked as retired");
    expect(saved().journal).toHaveLength(1);
    expect(saved().journal[0]).toMatchObject({ kind: "retire", label: "Retire 21.11" });
    expect(saved().journal[0].effects.map((e) => e.kind)).toEqual(["note-rewrite", "moved", "line"]);
    expect(v.exists(FOLDER)).toBe(false);
    await undo();
    expect(snapshot(v)).toEqual(before);
    expect(data.journal.entries).toEqual([]);
    expect(saved().journal).toEqual([]);
  });

  it("a retirement that fails halfway stays in the journal, and undo puts the note back", async () => {
    const { v, entry } = setup();
    const before = snapshot(v);
    const { p, data, undo, saved } = await pluginFor(v);
    vi.mocked(v.app.fileManager.renameFile).mockRejectedValueOnce(new Error("Move failed"));
    await p.retireFlow(entry);
    expect(notices()).toContain("Move failed");
    expect(saved().journal).toHaveLength(1);
    expect(saved().journal[0].effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
    await undo();
    expect(snapshot(v)).toEqual(before);
    expect(data.journal.entries).toEqual([]);
  });

  it("an edit after retiring makes undo refuse and keeps the entry for another try", async () => {
    const { v, entry } = setup();
    const { p, data, undo, said, saved } = await pluginFor(v);
    await p.retireFlow(entry);
    v.setFm(NOTE, "descripcion", "Edited later");
    expect(await undo()).toBeNull();
    expect(said.at(-1)).toMatch(/^Undo stopped: .*edited after.* The operation stays in the journal\.$/);
    expect(data.journal.entries).toHaveLength(1);
    expect(saved().journal[0].effects.map((e) => e.kind)).toEqual(["note-rewrite"]);
    expect(v.frontmatter.get(NOTE)).toMatchObject({ descripcion: "Edited later" });
  });
});
