/**
 * «Date files when they are created» only dates files made on this device. A file that arrives
 * through Obsidian Sync also fires `create`, and its ctime is the arrival (measured on 12 Oct 2026),
 * so dating it on the receiving device used the wrong date and raced the sender's own rename.
 * Lumbre 78d718c0 (3740343d, 26954f77).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PluginManifest, TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { LOCAL_OPEN_WINDOW_MS, LocalCreations } from "../src/vault/local-creation";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

afterEach(() => vi.restoreAllMocks());

const FOLDER = "10-19 Area/11 Category/11.11 Note";
const DATED = "---\nfecha: 2026-10-12\n---\nBody\n";

/** The plugin loaded on a fake vault with one ID, the layout ready and `dateOnCreate` as given. */
async function host(dateOnCreate = true) {
  const v = new FakeObsidianVault();
  v.file("JDex/11.11 Note.md");
  v.folder(FOLDER);
  v.setLayoutReady(false); // `onLayoutReady` callbacks stay queued: the test never opens a real layout
  const plugin = new JdexManagerPlugin(v.app, {} as PluginManifest);
  Object.assign(plugin, {
    app: v.app,
    loadData: async () => ({ jdexFolder: "JDex", dateOnCreate }),
    saveData: vi.fn(async () => {}),
    addSettingTab: vi.fn(),
    addStatusBarItem: () => ({ addClass: vi.fn(), setText: vi.fn() }),
    registerDomEvent: vi.fn(),
    registerEvent: vi.fn(),
    registerView: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEditorSuggest: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
    addCommand: vi.fn(),
  });
  await plugin.onload();
  v.setLayoutReady(true);
  vi.spyOn(plugin, "refreshSystemIndex").mockResolvedValue(undefined);
  vi.spyOn(plugin, "refreshHeaders").mockResolvedValue(undefined);
  return { plugin, v };
}

/** Lets the event handlers, which the plugin starts with `void`, finish. */
async function flush(v: FakeObsidianVault) {
  await v.settle();
  // eslint-disable-next-line obsidianmd/prefer-active-window-timers -- Node test: there is no activeWindow.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("date on create: only files created on this device", () => {
  it("a file that arrives through Sync (created, never opened) is not dated", async () => {
    const { v } = await host();
    await v.app.vault.create(`${FOLDER}/Recibida.md`, DATED);
    await flush(v);
    expect(v.exists(`${FOLDER}/Recibida.md`)).toBe(true);
    expect(v.exists(`${FOLDER}/2026-10-12 Recibida.md`)).toBe(false);
  });

  it("a note Obsidian opens right after creating it is dated", async () => {
    const { v } = await host();
    const file = await v.app.vault.create(`${FOLDER}/Nueva.md`, DATED);
    v.emitWorkspace("file-open", file);
    await flush(v);
    expect(v.exists(`${FOLDER}/2026-10-12 Nueva.md`)).toBe(true);
    expect(v.exists(`${FOLDER}/Nueva.md`)).toBe(false);
  });

  it("a received file the user opens after the window is not dated", async () => {
    const { v } = await host();
    const file = await v.app.vault.create(`${FOLDER}/Recibida.md`, DATED);
    await flush(v);
    const later = Date.now() + LOCAL_OPEN_WINDOW_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(later);
    v.emitWorkspace("file-open", file);
    await flush(v);
    expect(v.exists(`${FOLDER}/Recibida.md`)).toBe(true);
  });

  it("opening another file, or none, does not date the file that just arrived", async () => {
    const { v } = await host();
    await v.app.vault.create(`${FOLDER}/Recibida.md`, DATED);
    v.emitWorkspace("file-open", v.app.vault.getAbstractFileByPath("JDex/11.11 Note.md"));
    v.emitWorkspace("file-open", null);
    await flush(v);
    expect(v.exists(`${FOLDER}/Recibida.md`)).toBe(true);
  });

  it("a note created and opened in the JDex folder is never dated", async () => {
    const { v } = await host();
    const file = await v.app.vault.create("JDex/11.12 Otra.md", DATED);
    v.emitWorkspace("file-open", file);
    await flush(v);
    expect(v.exists("JDex/11.12 Otra.md")).toBe(true);
  });

  it("control: with the setting off, a note created and opened is not dated", async () => {
    const { v } = await host(false);
    const file = await v.app.vault.create(`${FOLDER}/Nueva.md`, DATED);
    v.emitWorkspace("file-open", file);
    await flush(v);
    expect(v.exists(`${FOLDER}/Nueva.md`)).toBe(true);
  });
});

describe("LocalCreations", () => {
  const file = (path: string) => Object.assign(new TFile(), { path });

  it("takes a created file opened within the window, once", () => {
    let now = 0;
    const local = new LocalCreations(() => now, 100);
    const a = file("a.md");
    local.add(a);
    now = 100;
    expect(local.take(a)).toBe(a);
    expect(local.take(a)).toBeNull();
  });

  it("drops a file once its window has passed, and ignores files it never saw", () => {
    let now = 0;
    const local = new LocalCreations(() => now, 100);
    const a = file("a.md");
    const b = file("b.md");
    local.add(a);
    now = 50;
    local.add(b);
    now = 101;
    expect(local.take(a)).toBeNull();
    expect(local.take(b)).toBe(b);
    expect(local.take(file("c.md"))).toBeNull();
    expect(local.take(null)).toBeNull();
  });
});
