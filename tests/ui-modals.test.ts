// @vitest-environment happy-dom
/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc, obsidianmd/prefer-active-window-timers, obsidianmd/no-tfile-tfolder-cast -- DOM fixtures under happy-dom: there is no activeDocument, activeWindow or Obsidian element helper on the elements the test builds itself, and the casts only read the double's own files. */
/*
 * Behaviour of the dialogs, suggesters and views in src/ui that had no test of their own (v8 coverage of
 * the focal run: confirm 0%, inbox 15%, autocomplete 18%, folder-suggest 38%, go-to-id 45%, create-structure
 * 41%, create-id 51%). They run on the loud stub's modelled classes and the shared vault double.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Modal, Platform, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { buildIndex, type CategoryEntry, type IdEntry } from "../src/jd/index";
import type { Effect } from "../src/jd/journal";
import { DEFAULT_SETTINGS, type JdexManagerSettings } from "../src/settings";
import { confirm } from "../src/ui/confirm";
import { IdEditorSuggest } from "../src/ui/autocomplete";
import { CategorySuggestModal, CreateIdModal } from "../src/ui/create-id";
import { AreaSuggestModal, CreateAreaModal, CreateCategoryModal } from "../src/ui/create-structure";
import { FolderSuggest } from "../src/ui/folder-suggest";
import { IdSuggestModal, openEntry } from "../src/ui/go-to-id";
import { IdPanelView } from "../src/ui/id-panel";
import { ProcessInboxModal } from "../src/ui/inbox";
import { currentPlatform } from "../src/ui/platform-hints";
import { scanVault } from "../src/vault/scan";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { installObsidianDom } from "./support/obsidian-dom";
import { buttons, notices, registeredEvents, resetStub, settings as builtSettings, textFields, toggles } from "./support/obsidian-stub-api";

installObsidianDom();

const settings = (over: Partial<JdexManagerSettings> = {}): JdexManagerSettings => ({ ...DEFAULT_SETTINGS, jdexFolder: "J", ...over });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The newest button with that label: dialogs re-render, so older ones belong to stale screens. */
const button = (text: string) => buttons().filter((b) => b.text === text).at(-1)!;
/** Every modal opened through `Modal.prototype.open` since the spy was installed. */
let opened: MockInstance;
const modals = () => opened.mock.contexts as Modal[];

beforeEach(() => {
  resetStub();
  opened = vi.spyOn(Modal.prototype, "open");
});
afterEach(() => vi.restoreAllMocks());

function entry(id: string, title: string, over: Partial<IdEntry> = {}): IdEntry {
  const label = `${id} ${title}`;
  return { id, category: id.slice(0, 2), title, label, notePath: `J/${label}.md`, folderPath: `20-29 Area/21 Cat/${label}`, ...over };
}

describe("confirm", () => {
  it("shows the title and lines and resolves true on the confirm button", async () => {
    const answer = confirm({} as App, "Delete?", ["a.pdf", "Goes to the trash."], "Delete");
    const modal = modals().at(-1)!;
    expect(modal.titleEl.textContent).toBe("Delete?");
    expect([...modal.contentEl.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["a.pdf", "Goes to the trash."]);
    expect(button("Delete").cta).toBe(true);
    button("Delete").click();
    await expect(answer).resolves.toBe(true);
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(false);
  });

  it("resolves false on Cancel, and false when the dialog is closed without answering", async () => {
    const cancelled = confirm({} as App, "Sure?", []);
    button("Cancel").click();
    await expect(cancelled).resolves.toBe(false);

    const dismissed = confirm({} as App, "Sure?", []);
    modals().at(-1)!.close(); // Escape or a click outside
    await expect(dismissed).resolves.toBe(false);
  });
});

describe("platform hints and the Go to ID suggester", () => {
  it("currentPlatform reads the host flags at call time", () => {
    Platform.isMobile = true;
    Platform.isMacOS = false;
    expect(currentPlatform()).toEqual({ isMobile: true, isMacOS: false });
    Platform.isMobile = false;
    expect(currentPlatform().isMobile).toBe(false);
  });

  it("filters by label, shows every ID for an empty query, and reports the modifier on choose", () => {
    Platform.isMobile = false;
    Platform.isMacOS = true;
    const ids = [entry("21.11", "Hebra"), entry("21.12", "Lumbre", { notePath: undefined })];
    const picks: Array<[string, boolean]> = [];
    const modal = new IdSuggestModal({} as App, { ids } as never, (picked, folder) => picks.push([picked.id, folder]));
    expect((modal as unknown as { instructions: unknown[] }).instructions).toEqual([
      { command: "↵", purpose: "open the note" },
      { command: "⌘ ↵", purpose: "open the folder" },
    ]);
    expect(modal.getSuggestions("  ")).toEqual(ids);
    expect(modal.getSuggestions("LUMB").map((e) => e.id)).toEqual(["21.12"]);
    modal.onChooseSuggestion(ids[0], { metaKey: false, ctrlKey: false } as KeyboardEvent);
    modal.onChooseSuggestion(ids[0], { metaKey: true, ctrlKey: false } as KeyboardEvent);
    expect(picks).toEqual([["21.11", false], ["21.11", true]]);
    const row = document.createElement("div");
    modal.renderSuggestion(ids[1], row);
    expect(row.textContent).toContain("21.12 Lumbre");
    expect(row.textContent).toContain("no note · folder");
    Platform.isMacOS = false;
  });

  it("openEntry opens the note, or the first Markdown file of the folder, and explains what is missing", async () => {
    const v = new FakeObsidianVault();
    const note = v.file("J/21.11 Hebra.md");
    v.folder("20-29 Area/21 Cat/21.11 Hebra");
    const inside = v.file("20-29 Area/21 Cat/21.11 Hebra/Detail.md");
    v.file("20-29 Area/21 Cat/21.12 Empty/scan.pdf");
    const hebra = entry("21.11", "Hebra");
    expect(await openEntry(v.app, hebra, false)).toBeNull();
    expect(await openEntry(v.app, hebra, true)).toBeNull();
    expect(v.opened).toEqual([note, inside]);
    expect(await openEntry(v.app, entry("21.12", "Empty"), true)).toBe("21.12 Empty: the folder has no note to open.");
    expect(await openEntry(v.app, entry("21.13", "Ghost", { notePath: undefined, folderPath: undefined }), false)).toBe("21.13 Ghost has no note.");
    expect(await openEntry(v.app, entry("21.13", "Ghost", { notePath: undefined, folderPath: undefined }), true)).toBe("21.13 Ghost has no folder.");
    expect(v.opened).toHaveLength(2);
  });
});

describe("FolderSuggest", () => {
  it("offers vault folders (never the root) matching every word, and writes the choice like typing it", () => {
    const v = new FakeObsidianVault();
    v.folder("20-29 Area/21 Cat/21.11 Hebra");
    v.folder("Archive");
    v.file("note.md");
    const input = document.createElement("input");
    const typed = vi.fn();
    input.addEventListener("input", typed);
    const suggest = new FolderSuggest(v.app, input);
    expect(suggest.getSuggestions("")).not.toContain("/");
    expect(suggest.getSuggestions("hebra 21")).toEqual(["20-29 Area/21 Cat/21.11 Hebra"]);
    expect(suggest.getSuggestions("archive")).toEqual(["Archive"]);
    expect(suggest.getSuggestions("note.md")).toEqual([]);
    const row = document.createElement("div");
    suggest.renderSuggestion("Archive", row);
    expect(row.textContent).toBe("Archive");
    suggest.selectSuggestion("Archive");
    expect(input.value).toBe("Archive");
    expect(typed).toHaveBeenCalledTimes(1);
    expect((suggest as unknown as { closed: number }).closed).toBe(1);
  });
});

describe("IdEditorSuggest", () => {
  const ids = [entry("21.11", "Hebra"), entry("21.12", "Lumbre", { notePath: undefined }), entry("21.11+", "Child"), entry("21.11", "Prefixed", { system: "D01" })];
  const make = (mode: "link" | "number" = "link", enabled = true) => new IdEditorSuggest({} as App, () => ({ ids }) as never, () => mode, () => enabled);
  const editorWith = (line: string, ch = line.length) => ({
    getLine: () => line,
    getRange: (from: { ch: number }, to: { ch: number }) => line.slice(from.ch, to.ch),
    replaceRange: vi.fn(),
    setCursor: vi.fn(),
    cursor: { line: 0, ch },
  });

  it("triggers on an ID-like prefix after a word boundary or [[, and not when disabled", () => {
    const suggest = make();
    const typing = (line: string) => suggest.onTrigger(editorWith(line).cursor, editorWith(line) as never, null);
    expect(typing("see 21.1")).toMatchObject({ query: "21.1", start: { line: 0, ch: 4 } });
    expect(typing("[[21.")).toMatchObject({ query: "21.", start: { ch: 0 } });
    expect(typing("(D01.21.")).toMatchObject({ query: "D01.21." });
    expect(typing("abc21.1")).toBeNull();
    expect(typing("version 2.1")).toBeNull();
    expect(make("link", false).onTrigger({ line: 0, ch: 8 }, editorWith("see 21.1") as never, null)).toBeNull();
  });

  it("suggests IDs that start with the query, excluding children, and renders note or folder-only", () => {
    const suggest = make();
    expect(suggest.getSuggestions({ query: "21.1" } as never).map((e) => e.label)).toEqual(["21.11 Hebra", "21.12 Lumbre"]);
    expect(suggest.getSuggestions({ query: "D01.21" } as never).map((e) => e.system)).toEqual(["D01"]);
    const row = document.createElement("div");
    suggest.renderSuggestion(ids[1], row);
    expect(row.textContent).toBe("21.12 Lumbrefolder only");
  });

  it("inserts a wikilink, or only the number with Shift, in number mode or without a note", () => {
    const pick = (suggest: IdEditorSuggest, chosen: IdEntry, evt: Partial<KeyboardEvent> = {}, line = "see 21.1", start = line.lastIndexOf(" ") + 1) => {
      const editor = editorWith(line);
      Object.assign(suggest, { context: { editor, start: { line: 0, ch: start }, end: editor.cursor, query: "21.1" } });
      suggest.selectSuggestion(chosen, evt as KeyboardEvent);
      return editor;
    };
    const link = pick(make(), ids[0]);
    expect(link.replaceRange).toHaveBeenCalledWith("[[21.11 Hebra]]", expect.anything(), expect.anything());
    expect(link.setCursor).toHaveBeenCalledWith({ line: 0, ch: 4 + "[[21.11 Hebra]]".length });
    expect(pick(make(), ids[0], { shiftKey: true }).replaceRange).toHaveBeenCalledWith("21.11", expect.anything(), expect.anything());
    expect(pick(make("number"), ids[0]).replaceRange).toHaveBeenCalledWith("21.11", expect.anything(), expect.anything());
    expect(pick(make(), ids[1]).replaceRange).toHaveBeenCalledWith("21.12", expect.anything(), expect.anything());
    // Typed inside [[ ]], number-only still produces a link: a bare number there would break it.
    expect(pick(make("number"), ids[0], {}, "[[21.1", 0).replaceRange).toHaveBeenCalledWith("[[21.11 Hebra]]", expect.anything(), expect.anything());
  });

  it("does nothing without a context", () => {
    expect(() => make().selectSuggestion(ids[0], {} as KeyboardEvent)).not.toThrow();
  });
});

describe("ProcessInboxModal", () => {
  const INBOX = "20-29 Area/21 Cat/21.01 Inbox";
  const ARCHIVE = "20-29 Area/21 Cat/21.09 Archive";
  function inboxVault() {
    const v = new FakeObsidianVault();
    v.folder(INBOX);
    v.folder(ARCHIVE);
    v.folder("20-29 Area/21 Cat/21.11 Hebra");
    v.file(`${INBOX}/scan.pdf`, "pdf", undefined, new Date(2026, 9, 12, 8, 0).getTime());
    v.file(`${INBOX}/idea.md`, "# An idea\n");
    v.file("J/21.11 Hebra.md");
    const index = scanVault(v.app, settings());
    const files = [v.app.vault.getAbstractFileByPath(`${INBOX}/scan.pdf`), v.app.vault.getAbstractFileByPath(`${INBOX}/idea.md`)] as TFile[];
    const operations: Array<{ label: string; effects: Effect[] }> = [];
    const ctx = { index, systemRoot: "", dateFormat: "YYYY-MM-DD" as const, journal: (_kind: "move", label: string) => { const effects: Effect[] = []; operations.push({ label, effects }); return effects; } };
    const done = vi.fn(async () => {});
    const modal = new ProcessInboxModal(v.app, files, ctx, done);
    return { v, modal, done, operations };
  }

  it("shows the file, skips to the next, and reports when nothing is left", async () => {
    const { modal } = inboxVault();
    modal.open();
    await tick();
    expect(modal.contentEl.querySelector("h3")?.textContent).toBe("scan.pdf");
    expect(modal.titleEl.textContent).toBe("Inbox · 2 left");
    button("Skip").click();
    await tick();
    expect(modal.contentEl.querySelector("h3")?.textContent).toBe("idea.md");
    expect(modal.contentEl.querySelector("pre")?.textContent).toBe("# An idea\n");
    expect(buttons().some((b) => b.text === "Open")).toBe(true);
    button("Skip").click();
    await tick();
    expect(modal.contentEl.textContent).toContain("Nothing left. 0 file(s) moved or archived in this pass.");
  });

  it("archives with the file's date in the name and journals the move with its identity", async () => {
    const { v, modal, operations } = inboxVault();
    modal.open();
    await tick();
    expect(button("Archive to 21.09").disabled).toBe(false);
    button("Archive to 21.09").click();
    await tick();
    expect(v.exists(`${ARCHIVE}/2026-10-12 scan.pdf`)).toBe(true);
    expect(v.exists(`${INBOX}/scan.pdf`)).toBe(false);
    expect(operations).toEqual([{ label: "Archive scan.pdf", effects: [expect.objectContaining({ kind: "moved", from: `${INBOX}/scan.pdf`, to: `${ARCHIVE}/2026-10-12 scan.pdf`, type: "file" })] }]);
    expect(modal.contentEl.querySelector("h3")?.textContent).toBe("idea.md");
  });

  it("moves to the ID chosen in the picker, and tells when that ID has no folder", async () => {
    const { v, modal, operations } = inboxVault();
    modal.open();
    await tick();
    button("Move to ID").click();
    const picker = modals().at(-1) as unknown as IdSuggestModal;
    expect(picker).toBeInstanceOf(IdSuggestModal);
    picker.onChooseSuggestion(entry("21.99", "No folder", { folderPath: undefined }), {} as KeyboardEvent);
    expect(notices()).toContain("21.99 No folder has no folder. Create it first.");
    expect(v.exists(`${INBOX}/scan.pdf`)).toBe(true);
    picker.onChooseSuggestion(entry("21.11", "Hebra", { folderPath: "20-29 Area/21 Cat/21.11 Hebra" }), {} as KeyboardEvent);
    await tick();
    expect(v.exists("20-29 Area/21 Cat/21.11 Hebra/scan.pdf")).toBe(true);
    expect(operations.map((o) => o.label)).toEqual(["Move scan.pdf to 21.11"]);
  });

  it("keeps the file and says why when the destination already has one with that name", async () => {
    const { v, modal } = inboxVault();
    v.file("20-29 Area/21 Cat/21.11 Hebra/scan.pdf", "other");
    modal.open();
    await tick();
    button("Move to ID").click();
    (modals().at(-1) as unknown as IdSuggestModal).onChooseSuggestion(entry("21.11", "Hebra", { folderPath: "20-29 Area/21 Cat/21.11 Hebra" }), {} as KeyboardEvent);
    await tick();
    expect(notices().join(" ")).toContain("scan.pdf already exists.");
    expect(v.exists(`${INBOX}/scan.pdf`)).toBe(true);
    expect(modal.contentEl.querySelector("h3")?.textContent).toBe("scan.pdf");
  });

  it("deletes only after confirmation, journaling a Markdown file with its content", async () => {
    const { v, modal, operations } = inboxVault();
    modal.open();
    await tick();
    button("Skip").click();
    await tick(); // now idea.md
    const remove = button("Delete");
    remove.click();
    await tick();
    button("Cancel").click(); // the confirmation dialog
    await tick();
    expect(v.exists(`${INBOX}/idea.md`)).toBe(true);
    remove.click();
    await tick();
    expect(modals().at(-1)!.contentEl.textContent).toContain("It goes to the trash");
    button("Delete").click(); // the confirm button of the new dialog
    await tick();
    expect(v.exists(`${INBOX}/idea.md`)).toBe(false);
    expect(operations).toEqual([{ label: "Delete idea.md from the inbox", effects: [{ kind: "trashed-note", path: `${INBOX}/idea.md`, content: "# An idea\n" }] }]);
  });

  it("opens a Markdown file in the editor and closing calls onDone", async () => {
    const { v, modal, done } = inboxVault();
    modal.open();
    await tick();
    button("Skip").click();
    await tick();
    button("Open").click();
    expect(v.opened.map((f) => f.path)).toEqual([`${INBOX}/idea.md`]);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("IdPanelView", () => {
  function panelVault() {
    const v = new FakeObsidianVault();
    v.folder("20-29 Area/21 Cat/21.11 Hebra/sub");
    v.file("20-29 Area/21 Cat/21.11 Hebra/Plan.md");
    v.file("20-29 Area/21 Cat/21.11 Hebra/z.pdf");
    v.file("J/21.10 ■ Header.md");
    v.file("J/21.11 Hebra.md", "---\ndescripcion: Notes app\n---\n");
    v.file("J/21.12 Lumbre.md");
    v.file("J/21.11+ Child.md");
    v.folder("20-29 Area/21 Cat/21.12 Lumbre");
    v.folder("20-29 Area/21 Cat/21.10 ■ Header");
    return v;
  }
  function viewFor(v: FakeObsidianVault, jdexFolder = "J") {
    const config = settings({ jdexFolder });
    const view = new IdPanelView({ app: v.app } as unknown as WorkspaceLeaf, { index: () => scanVault(v.app, config), settings: () => config });
    return view;
  }

  it("explains itself without a JDex folder, without an active file and outside an ID", async () => {
    const v = panelVault();
    await viewFor(v, "").onOpen();
    const empty = viewFor(v, "");
    empty.render();
    expect(empty.contentEl.textContent).toContain("No folder is set for the index");
    const view = viewFor(v);
    view.render();
    expect(view.contentEl.textContent).toBe("Open a file inside an ID.");
    v.setActiveFile(v.file("Elsewhere/loose.md"));
    view.render();
    expect(view.contentEl.textContent).toBe("The active file is not inside an ID.");
  });

  it("shows the ID, its description, files, children and siblings, and the links open notes", async () => {
    const v = panelVault();
    const view = viewFor(v);
    v.setActiveFile(v.app.vault.getAbstractFileByPath("20-29 Area/21 Cat/21.11 Hebra/Plan.md") as TFile);
    await view.onOpen();
    const text = view.contentEl.textContent ?? "";
    expect(text).toContain("Notes app");
    expect(text).toContain("Plan.md");
    expect(text).toContain("sub/");
    expect(text).toContain("Children (+)");
    expect(text).toContain("21.11+ Child");
    expect(text).toContain("Under 21.10 ■ Header");
    expect(view.contentEl.querySelector(".jdex-panel-current")?.textContent).toBe("21.11 Hebra");
    const note = [...view.contentEl.querySelectorAll<HTMLElement>("a")].find((a) => a.textContent === "JDex note")!;
    expect(note.getAttribute("role")).toBe("link");
    note.click();
    await tick();
    expect(v.opened.at(-1)?.path).toBe("J/21.11 Hebra.md");
    const file = [...view.contentEl.querySelectorAll<HTMLElement>("a")].find((a) => a.textContent === "Plan.md")!;
    file.click();
    await tick();
    expect(v.opened.at(-1)?.path).toBe("20-29 Area/21 Cat/21.11 Hebra/Plan.md");
  });

  it("subscribes to file-open and to create, delete and rename, and redraws on each", async () => {
    const v = panelVault();
    const view = viewFor(v);
    await view.onOpen();
    // file-open, create, delete, rename, and the metadata cache repaint (the description comes from it).
    expect(registeredEvents(view)).toHaveLength(5);
    expect(view.contentEl.textContent).toBe("Open a file inside an ID.");
    v.setActiveFile(v.app.vault.getAbstractFileByPath("J/21.12 Lumbre.md") as TFile);
    v.emitWorkspace("file-open");
    expect(view.contentEl.textContent).toContain("21.12 Lumbre");
    v.emit("rename", v.app.vault.getAbstractFileByPath("J/21.12 Lumbre.md"), "J/old.md");
    v.emit("create", v.app.vault.getAbstractFileByPath("J/21.12 Lumbre.md"));
    v.emit("delete", v.app.vault.getAbstractFileByPath("J/21.12 Lumbre.md"));
    expect(view.contentEl.querySelectorAll(".jdex-panel-path")).toHaveLength(1);
    expect(view.getViewType()).toBe("jdex-id-panel");
  });

  it("with an index-changed source it listens to the plugin instead of the vault, and cleans up", async () => {
    const v = panelVault();
    const listeners = new Set<() => void>();
    const config = settings();
    const view = new IdPanelView({ app: v.app } as unknown as WorkspaceLeaf, {
      index: () => scanVault(v.app, config),
      settings: () => config,
      onIndexChanged: (listener) => { listeners.add(listener); return () => void listeners.delete(listener); },
    });
    v.setActiveFile(v.app.vault.getAbstractFileByPath("J/21.12 Lumbre.md") as TFile);
    await view.onOpen();
    expect(v.listeners("create") + v.listeners("rename") + v.listeners("delete")).toBe(0);
    expect(listeners.size).toBe(1);
    v.file("J/21.13 New.md");
    v.folder("20-29 Area/21 Cat/21.13 New");
    expect(view.contentEl.textContent).not.toContain("21.13 New"); // nothing redraws until the plugin says so
    [...listeners].forEach((listener) => listener());
    expect(view.contentEl.textContent).toContain("21.13 New");
    ((view as unknown as { registered: Array<() => void> }).registered).forEach((cleanup) => cleanup());
    expect(listeners.size).toBe(0);
  });

  it("repaints the description when the metadata cache reparses the shown note, not before", async () => {
    const v = new FakeObsidianVault({ cacheDelay: true });
    v.folder("20-29 Area/21 Cat/21.11 Hebra");
    const note = v.file("J/21.11 Hebra.md", "---\ndescripcion: Old\n---\n");
    const view = viewFor(v);
    v.setActiveFile(note);
    await view.onOpen();
    expect(view.contentEl.textContent).toContain("Old");
    await v.app.vault.process(note, (text) => text.replace("Old", "New"));
    expect(view.contentEl.textContent).toContain("Old"); // the cache still holds the old frontmatter (assumption A1)
    v.flushCache();
    expect(view.contentEl.textContent).toContain("New");
    expect(view.contentEl.textContent).not.toContain("Old");
  });
});

describe("category and area pickers", () => {
  const index = buildIndex({
    systemRoot: "",
    jdexFolder: "J",
    folderPaths: ["20-29 Area", "20-29 Area/21 Cat", "20-29 Area/21 Cat/21.11 Hebra", "30-39 Other", "30-39 Other/31 Misc"],
    notePaths: ["J/21.11 Hebra.md"],
  });

  it("CategorySuggestModal filters by label, renders usage and hands the category over", () => {
    const picked: CategoryEntry[] = [];
    const modal = new CategorySuggestModal({} as App, index, (category) => picked.push(category));
    expect(modal.getSuggestions("")).toHaveLength(2);
    expect(modal.getSuggestions(" misc ").map((c) => c.number)).toEqual(["31"]);
    const row = document.createElement("div");
    modal.renderSuggestion(index.categories[0], row);
    expect(row.textContent).toMatch(/^21 Cat20-29 · \d+ of \d+ used · next 21\.\d+$/);
    modal.onChooseSuggestion(index.categories[0]);
    expect(picked.map((c) => c.number)).toEqual(["21"]);
    expect((modal as unknown as { placeholder: string }).placeholder).toBe("Category for the new ID");
  });

  it("AreaSuggestModal filters by label and hands the area over", () => {
    const picked: string[] = [];
    const modal = new AreaSuggestModal({} as App, index, (area) => picked.push(area.label));
    expect(modal.getSuggestions("")).toHaveLength(2);
    expect(modal.getSuggestions("other").map((a) => a.label)).toEqual(["30-39 Other"]);
    modal.onChooseSuggestion(index.areas[0]);
    expect(picked).toEqual(["20-29 Area"]);
  });
});

describe("CreateIdModal", () => {
  function setup() {
    const v = new FakeObsidianVault();
    v.folder("J");
    v.folder("20-29 Area/21 Cat/21.01 Inbox");
    v.file("J/21.01 Inbox.md");
    v.file("J/21.12 Taken.md");
    const config = settings();
    const index = scanVault(v.app, config);
    const category = index.categories.find((c) => c.number === "21")!;
    const onSubmit = vi.fn(async () => {});
    const modal = new CreateIdModal(v.app, index, category, config, onSubmit);
    return { v, modal, onSubmit, config, category };
  }
  const type = (field: number, value: string) => textFields()[field].type(value);

  it("proposes the next free number, blocks Create until the title is given, then submits and closes", async () => {
    const { modal, onSubmit, config } = setup();
    modal.open();
    expect(modal.titleEl.textContent).toBe("New ID in 21 Cat");
    expect(textFields()[0].value).toBe("21.13");
    expect(textFields()[0].inputEl.classList.contains("jdex-id-input")).toBe(true);
    expect(modal.contentEl.querySelector(".jdex-validation")?.textContent).toBe("Give the ID a title.");
    expect(button("Create").disabled).toBe(true);
    type(1, "Hebra sync");
    expect(modal.contentEl.querySelector(".jdex-validation")?.textContent).toBe("");
    expect(button("Create").disabled).toBe(false);
    toggles()[0].toggle(); // also create the folder
    button("Create").click();
    await tick();
    expect(onSubmit).toHaveBeenCalledWith({ id: "21.13", title: "Hebra sync", createFolder: !DEFAULT_SETTINGS.createFolderByDefault, createPattern: DEFAULT_SETTINGS.createPatternByDefault });
    expect(config.createFolderByDefault).toBe(!DEFAULT_SETTINGS.createFolderByDefault);
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(false);
  });

  it("validates a typed number live: wrong category, header, reserved and taken", () => {
    const { modal } = setup();
    modal.open();
    type(1, "Anything");
    const message = () => modal.contentEl.querySelector(".jdex-validation")?.textContent;
    type(0, "22.11");
    expect(message()).toBe("The ID must belong to category 21.");
    type(0, "21.20");
    expect(message()).toBe("IDs ending in 0 are headers.");
    type(0, "21.05");
    expect(message()).toBe(".00 to .09 are reserved for managing the category.");
    type(0, "21.12");
    expect(message()).toBe("Already used by 21.12 Taken.");
    type(0, "nonsense");
    expect(message()).toBe("Type an ID like 21.23.");
    expect(button("Create").disabled).toBe(true);
    type(0, "21.15");
    expect(message()).toBe("");
    expect(button("Create").disabled).toBe(false);
  });

  it("Enter in the dialog submits when valid, and does nothing while Create is disabled", async () => {
    const { modal, onSubmit } = setup();
    modal.open();
    const enter = () => modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    enter();
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    type(1, "Typed title");
    enter();
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("offers the subfolder pattern toggle only for a category that has a pattern", () => {
    const { v, category } = setup();
    const index = scanVault(v.app, settings());
    const open = (over: Partial<JdexManagerSettings>) => {
      resetStub();
      new CreateIdModal(v.app, index, category, settings(over), vi.fn(async () => {})).open();
      return builtSettings().map((s) => s.name).filter((name) => name !== "");
    };
    expect(open({ subfolderPattern: "", subfolderPatternsByCategory: {} })).toEqual(["Number", "Title", "Also create the folder"]);
    expect(open({ subfolderPattern: "", subfolderPatternsByCategory: { "21": "10 Docs\n20 Notes" } })).toContain("Also create the subfolder pattern");
    expect(builtSettings().find((s) => s.name.includes("subfolder pattern"))?.desc).toBe("10 Docs, 20 Notes");
  });
});

describe("structure dialogs", () => {
  function setup() {
    const v = new FakeObsidianVault();
    v.folder("J");
    v.folder("20-29 Area/21 Cat");
    v.file("J/20-29 Area.md");
    v.file("J/21 Cat.md");
    const config = settings({ createFolderByDefault: true });
    const index = scanVault(v.app, config);
    return { v, index, config };
  }
  const type = (field: number, value: string) => textFields()[field].type(value);
  const message = (modal: Modal) => modal.contentEl.querySelector(".jdex-validation")?.textContent;

  it("CreateAreaModal creates the note, the folder and the management category, journals them and opens the note", async () => {
    const { v, index, config } = setup();
    const effects: Effect[] = [];
    const after = vi.fn(async () => {});
    const modal = new CreateAreaModal(v.app, index, config, after, effects);
    modal.open();
    expect(textFields()[0].value).toBe("10-19");
    expect(message(modal)).toBe("Give it a title.");
    type(1, "Personal");
    expect(message(modal)).toBe("");
    button("Create").click();
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    await tick();
    expect(v.exists("J/10-19 Personal.md")).toBe(true);
    expect(v.exists("10-19 Personal")).toBe(true);
    expect(v.exists("J/10 Gestión del área 10-19.md")).toBe(true);
    expect(v.exists("10-19 Personal/10 Gestión del área 10-19")).toBe(true);
    expect(effects.map((e) => e.kind)).toContain("created-folder");
    expect(effects.filter((e) => e.kind === "created-note").length).toBeGreaterThanOrEqual(2);
    expect(v.opened.map((f) => f.path)).toEqual(["J/10-19 Personal.md"]);
  });

  it("CreateAreaModal rejects an occupied area number before creating anything", () => {
    const { v, index, config } = setup();
    const modal = new CreateAreaModal(v.app, index, config, vi.fn(async () => {}));
    modal.open();
    type(1, "Clash");
    type(0, "20-29");
    expect(message(modal)).not.toBe("");
    expect(button("Create").disabled).toBe(true);
  });

  it("CreateCategoryModal proposes the next category of the area and creates note, folder, inbox and archive", async () => {
    const { v, index, config } = setup();
    const area = index.areas[0];
    const effects: Effect[] = [];
    const after = vi.fn(async () => {});
    const modal = new CreateCategoryModal(v.app, index, area, config, after, effects);
    modal.open();
    expect(textFields()[0].value).toBe("22");
    expect(modal.titleEl.textContent).toBe("New category in 20-29 Area");
    type(1, "Hobbies");
    button("Create").click();
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    await tick();
    expect(v.exists("J/22 Hobbies.md")).toBe(true);
    expect(v.exists("20-29 Area/22 Hobbies")).toBe(true);
    for (const zero of ["22.01 Inbox de la categoría 22", "22.09 Archivo de la categoría 22"]) {
      expect(v.exists(`J/${zero}.md`)).toBe(true);
      expect(v.exists(`20-29 Area/22 Hobbies/${zero}`)).toBe(true);
    }
  });

  it("re-reads the vault at confirm time: a number taken meanwhile is re-proposed and nothing is created", async () => {
    const { v, index, config } = setup();
    const modal = new CreateAreaModal(v.app, index, config, vi.fn(async () => {}));
    modal.open();
    expect(textFields()[0].value).toBe("10-19");
    type(1, "Personal");
    v.file("J/10-19 Another device.md"); // another device took the number after the dialog opened
    const before = v.bodies.size;
    button("Create").click();
    await tick();
    expect(message(modal)).toBe("That number was taken. Next free: 30-39.");
    expect(textFields()[0].inputEl.value).toBe("30-39");
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(true);
    expect(v.bodies.size).toBe(before);
    button("Create").click();
    await vi.waitFor(() => expect(v.exists("J/30-39 Personal.md")).toBe(true));
  });

  it("a failure while creating is shown as a notice and the dialog stays closed", async () => {
    const { v, index, config } = setup();
    const modal = new CreateAreaModal(v.app, index, config, vi.fn(async () => {}));
    modal.open();
    type(1, "Personal");
    await v.app.fileManager.trashFile(v.app.vault.getAbstractFileByPath("J")!); // the JDex folder vanishes meanwhile
    button("Create").click();
    await vi.waitFor(() => expect(notices().length).toBeGreaterThan(0));
    expect(notices()[0]).toContain("The JDex folder (J) does not exist");
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(false);
    expect(v.exists("J/10-19 Personal.md")).toBe(false);
  });
});
