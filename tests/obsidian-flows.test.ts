// The flows run through plain-function ports: no module is replaced (audit 12 Oct 2026, 5.3).
import { describe, expect, it, vi } from "vitest";
import { type App, TFile, TFolder, type TAbstractFile } from "obsidian";
import type { Effect } from "../src/jd/journal";
import type { IdEntry, JdIndex } from "../src/jd/index";
import { DEFAULT_SETTINGS } from "../src/settings";
import { type FlowPorts, type JournalSink, moveToId, sendToZero } from "../src/vault/flows";

function vault(extra: string[] = []) {
  const items: TAbstractFile[] = [];
  const folder = (path: string) => items.push(Object.assign(new TFolder(), { path, name: path.split("/").at(-1) }));
  for (const system of ["", "D02"]) {
    const p = system ? `${system}.` : "";
    for (const path of [`${p}20-29 Area`, `${p}20-29 Area/${p}21 Category`, `${p}20-29 Area/${p}21 Category/${p}21.01 Inbox`, `${p}20-29 Area/${p}21 Category/${p}21.12 Has folder`]) folder(path);
    for (const name of [`${p}21.01 Inbox.md`, `${p}21.09 Archive.md`, `${p}21.11 No folder.md`, `${p}21.12 Has folder.md`]) {
      items.push(Object.assign(new TFile(), { path: `JDex/${name}`, name, extension: "md" }));
    }
  }
  for (const path of extra) folder(path);
  const file = Object.assign(new TFile(), { path: "Loose.pdf", name: "Loose.pdf", extension: "pdf", stat: { ctime: new Date(2026, 2, 4).getTime() } });
  items.push(file);
  const createFolder = vi.fn(async (path: string) => void folder(path));
  const renameFile = vi.fn(async (target: TFile, path: string) => { target.path = path; target.name = path.split("/").at(-1)!; });
  const app = {
    vault: { getAllLoadedFiles: () => items, getAbstractFileByPath: (path: string) => items.find((f) => f.path === path) ?? null, createFolder },
    fileManager: { renameFile },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
  return { app, file, createFolder, renameFile };
}

function ports(app: App, choices: { entry?: (index: JdIndex) => IdEntry | null; category?: string | null; confirm?: boolean; dateOnMove?: boolean } = {}) {
  const notices: string[] = [];
  const journals: { kind: string; label: string; effects: Effect[]; flushed: boolean }[] = [];
  const recorded: { kind: string; label: string; effects: Effect[] }[] = [];
  const confirms: string[] = [];
  const pickCategory = vi.fn(async () => choices.category ?? null);
  const refreshInbox = vi.fn();
  const port: FlowPorts = {
    app,
    settings: { ...DEFAULT_SETTINGS, jdexFolder: "JDex", dateOnMove: choices.dateOnMove ?? false },
    pickEntry: vi.fn(async (index: JdIndex) => choices.entry?.(index) ?? null),
    pickCategory,
    confirm: vi.fn(async (title: string) => { confirms.push(title); return choices.confirm ?? true; }),
    notice: (message) => void notices.push(message),
    journal: (kind, label) => {
      const record = { kind, label, effects: [] as Effect[], flushed: false };
      journals.push(record);
      const sink: JournalSink = Object.assign(record.effects, { flush: async () => { record.flushed = true; } });
      return sink;
    },
    record: async (kind, label, effects) => void recorded.push({ kind, label, effects }),
    logError: vi.fn(),
    refreshInbox,
  };
  return { port, notices, journals, recorded, confirms, pickCategory, refreshInbox };
}

const pick = (id: string, system?: string) => (index: JdIndex) => index.ids.find((e) => e.id === id && e.system === system) ?? null;

describe("moveToId through ports", () => {
  it("creates the folder of a D02 ID in its own category after confirming, then moves and journals", async () => {
    const { app, file, createFolder, renameFile } = vault();
    const { port, notices, journals, confirms, refreshInbox } = ports(app, { entry: pick("21.11", "D02") });
    await moveToId(port, file);
    const target = "D02.20-29 Area/D02.21 Category/D02.21.11 No folder";
    expect(confirms).toEqual(["Create the folder of 21.11?"]);
    expect(createFolder).toHaveBeenCalledWith(target);
    expect(renameFile).toHaveBeenCalledWith(file, `${target}/Loose.pdf`);
    expect(journals).toHaveLength(1);
    expect(journals[0].effects.map((e) => e.kind)).toEqual(["created-folder", "moved"]);
    expect(journals[0].flushed).toBe(true);
    expect(notices).toEqual([`Moved to ${target}/Loose.pdf.`]);
    expect(refreshInbox).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the picker is dismissed or the folder creation is declined", async () => {
    const dismissed = vault();
    const a = ports(dismissed.app);
    await moveToId(a.port, dismissed.file);
    expect(dismissed.renameFile).not.toHaveBeenCalled();
    expect(a.journals).toHaveLength(0);

    const declined = vault();
    const b = ports(declined.app, { entry: pick("21.11"), confirm: false });
    await moveToId(b.port, declined.file);
    expect(declined.createFolder).not.toHaveBeenCalled();
    expect(declined.renameFile).not.toHaveBeenCalled();
  });

  it("moves into an existing folder without asking, dated only with dateOnMove", async () => {
    const plain = vault();
    const a = ports(plain.app, { entry: pick("21.12") });
    await moveToId(a.port, plain.file);
    expect(a.confirms).toEqual([]);
    expect(plain.renameFile).toHaveBeenCalledWith(plain.file, "20-29 Area/21 Category/21.12 Has folder/Loose.pdf");

    const dated = vault();
    const b = ports(dated.app, { entry: pick("21.12"), dateOnMove: true });
    await moveToId(b.port, dated.file);
    expect(dated.renameFile).toHaveBeenCalledWith(dated.file, "20-29 Area/21 Category/21.12 Has folder/2026-03-04 Loose.pdf");
  });
});

describe("sendToZero through ports", () => {
  it("asks for the category of a file outside the system and moves it to that inbox", async () => {
    const { app, file, renameFile } = vault();
    const { port, recorded, notices, pickCategory } = ports(app, { category: "D02.21" });
    await sendToZero(port, file, "01");
    expect(pickCategory).toHaveBeenCalledTimes(1);
    expect(renameFile).toHaveBeenCalledWith(file, "D02.20-29 Area/D02.21 Category/D02.21.01 Inbox/Loose.pdf");
    expect(recorded).toEqual([{ kind: "move", label: "Send to inbox Loose.pdf", effects: [expect.objectContaining({ kind: "moved", from: "Loose.pdf" })] }]);
    expect(notices).toEqual(["Moved to D02.20-29 Area/D02.21 Category/D02.21.01 Inbox/Loose.pdf."]);
  });

  it("stops when the category picker is dismissed, and warns when the zero has no folder", async () => {
    const dismissed = vault();
    const a = ports(dismissed.app, { category: null });
    await sendToZero(a.port, dismissed.file, "01");
    expect(dismissed.renameFile).not.toHaveBeenCalled();
    expect(a.notices).toEqual([]);

    const noArchive = vault();
    const b = ports(noArchive.app, { category: "21" });
    await sendToZero(b.port, noArchive.file, "09");
    expect(noArchive.renameFile).not.toHaveBeenCalled();
    expect(b.notices).toEqual(["21.09 has no folder. Create the category zeros first (Create category, or make the folder by hand)."]);
  });
});
