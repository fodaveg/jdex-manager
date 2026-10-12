// @vitest-environment happy-dom
/* These tests run against happy-dom's own `document`, not an Obsidian window, so the popout-window rules do not apply. */
/* eslint-disable obsidianmd/prefer-active-doc, obsidianmd/prefer-create-el */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import type { IdEntry, JdIndex } from "../src/jd/index";
import { makeKeyboardLink } from "../src/ui/keyboard-link";
import { IdPanelView } from "../src/ui/id-panel";
import { autocompleteInstructions, gotoIdInstructions } from "../src/ui/platform-hints";
import { matchFolderPaths } from "../src/ui/folder-suggest";

afterEach(() => {
  document.body.replaceChildren();
});

describe("makeKeyboardLink", () => {
  it("joins the tab order, is announced as a link and Enter activates it like a click", () => {
    const a = document.createElement("a");
    const onActivate = vi.fn();
    makeKeyboardLink(a, onActivate);
    expect(a.tabIndex).toBe(0);
    expect(a.getAttribute("role")).toBe("link");
    a.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    a.dispatchEvent(enter);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(enter.defaultPrevented).toBe(true);
    a.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});

describe("ID panel rows are reachable with Tab", () => {
  beforeAll(() => {
    // The Obsidian helpers the panel uses on HTMLElement, which happy-dom does not have.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const create = (parent: HTMLElement, tag: string, info: { text?: string; cls?: string } = {}): HTMLElement => {
      const el = document.createElement(tag);
      if (info.text !== undefined) el.textContent = info.text;
      if (info.cls) el.className = info.cls;
      parent.append(el);
      return el;
    };
    proto.createEl = function (this: HTMLElement, tag: string, info?: { text?: string; cls?: string }) {
      return create(this, tag, info);
    };
    proto.createDiv = function (this: HTMLElement, info?: { text?: string; cls?: string }) {
      return create(this, "div", info);
    };
    proto.createSpan = function (this: HTMLElement, info?: { text?: string; cls?: string }) {
      return create(this, "span", info);
    };
    proto.empty = function (this: HTMLElement) {
      this.replaceChildren();
    };
    proto.addClass = function (this: HTMLElement, cls: string) {
      this.classList.add(cls);
    };
    (globalThis as unknown as Record<string, unknown>).createEl = (tag: string) => document.createElement(tag);
  });

  it("note, folder, files, + children and siblings are all focusable links", () => {
    const e = (id: string, title: string, over: Partial<IdEntry> = {}): IdEntry => ({
      id,
      category: "21",
      title,
      label: `${id} ${title}`,
      notePath: `J/${id} ${title}.md`,
      folderPath: `A/${id} ${title}`,
      ...over,
    });
    const current = e("21.11", "Uno");
    const index = { ids: [current, e("21.11+", "Hijo"), e("21.12", "Dos"), e("21.10", "■ Cabecera", { folderPath: undefined })], categories: [], areas: [] } as unknown as JdIndex;
    const child = Object.assign(new TFile(), { name: "a.pdf", stat: { mtime: 0 }, path: "A/21.11 Uno/a.pdf" });
    const folder = Object.assign(new TFolder(), { children: [child] });
    const active = Object.assign(new TFile(), { path: "J/21.11 Uno.md" });
    const leaf = { openFile: vi.fn(async () => undefined) };
    const app = {
      workspace: { getActiveFile: () => active, getLeaf: () => leaf, on: () => ({}) },
      vault: { getAbstractFileByPath: (p: string) => (p === current.folderPath ? folder : null), on: () => ({}) },
      metadataCache: { getFileCache: () => null },
    };
    const view = new IdPanelView({} as never, { index: () => index, settings: () => ({ jdexFolder: "J" }) });
    (view as unknown as { app: unknown }).app = app;
    const contentEl = document.createElement("div");
    (view as unknown as { contentEl: HTMLElement }).contentEl = contentEl;
    document.body.append(contentEl);
    view.render();

    const links = [...contentEl.querySelectorAll<HTMLElement>(".jdex-panel-link")];
    // note, folder, the file, the + child and the sibling (the current row has a note too).
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      expect(link.tabIndex, link.textContent ?? "").toBe(0);
      expect(link.getAttribute("role")).toBe("link");
    }
    // Enter on the file row opens it, same as a click.
    const fileLink = links.find((l) => l.textContent === "a.pdf")!;
    fileLink.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(leaf.openFile).toHaveBeenCalledWith(child);
  });
});

describe("platform hints", () => {
  it("Go to ID: the folder modifier follows the platform and disappears on touch", () => {
    expect(gotoIdInstructions({ isMobile: false, isMacOS: true }).map((i) => i.command)).toEqual(["↵", "⌘ ↵"]);
    expect(gotoIdInstructions({ isMobile: false, isMacOS: false }).map((i) => i.command)).toEqual(["↵", "Ctrl ↵"]);
    expect(gotoIdInstructions({ isMobile: true, isMacOS: false }).map((i) => i.command)).toEqual(["↵"]);
  });

  it("autocomplete: no shift-enter hint on touch", () => {
    expect(autocompleteInstructions({ isMobile: false, isMacOS: true }).map((i) => i.command)).toEqual(["↵", "⇧ ↵"]);
    expect(autocompleteInstructions({ isMobile: true, isMacOS: false }).map((i) => i.command)).toEqual(["↵"]);
  });
});

describe("matchFolderPaths", () => {
  const paths = ["", "00-09 Sistema", "00-09 Sistema/00.00 JDex", "20-29 Trabajo/21 Software", "Inbox"];

  it("matches every typed word, case-insensitively, shortest first, never the root", () => {
    expect(matchFolderPaths(paths, "jdex 00")).toEqual(["00-09 Sistema/00.00 JDex"]);
    expect(matchFolderPaths(paths, "SISTEMA")).toEqual(["00-09 Sistema", "00-09 Sistema/00.00 JDex"]);
    expect(matchFolderPaths(paths, "")).not.toContain("");
  });

  it("is only a help: a path that matches nothing is simply not suggested", () => {
    expect(matchFolderPaths(paths, "zzz")).toEqual([]);
  });
});
