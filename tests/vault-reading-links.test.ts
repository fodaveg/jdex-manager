// @vitest-environment happy-dom
/* These tests run against happy-dom's own `document`, not an Obsidian window, so the popout-window rules do not apply. */
/* eslint-disable obsidianmd/prefer-active-doc, obsidianmd/prefer-create-el, no-unsanitized/property, @microsoft/sdl/no-inner-html */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type Plugin } from "obsidian";
import type { IdEntry, JdIndex } from "../src/jd/index";
import { registerReadingLinks } from "../src/vault/reading-links";

function entry(id: string, title: string, over: Partial<IdEntry> = {}): IdEntry {
  const label = `${id} ${title}`;
  return { id, category: id.slice(0, 2), title, label, notePath: `J/${label}.md`, folderPath: `A/${label}`, ...over };
}

function emptyIndex(ids: IdEntry[]): JdIndex {
  return { ids } as unknown as JdIndex;
}

function setup(initial: IdEntry[], extra: { choose?: (entries: IdEntry[]) => Promise<IdEntry | null> } = {}) {
  let ids = initial;
  const files = new Map<string, TFile>();
  const open = vi.fn(async (_file: TFile) => undefined);
  const getLeaf = vi.fn((_mode: unknown) => ({ openFile: open }));
  let process: ((el: HTMLElement) => void) | undefined;
  const plugin = {
    registerMarkdownPostProcessor: (fn: (el: HTMLElement) => void) => {
      process = fn;
    },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => {
          if (!files.has(path)) return null;
          return files.get(path)!;
        },
      },
      workspace: { getLeaf },
    },
  } as unknown as Plugin;
  registerReadingLinks(plugin, { index: () => emptyIndex(ids), enabled: () => true, ...extra });
  const render = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.append(el);
    process!(el);
    return el;
  };
  const addFile = (path: string): TFile => {
    const file = Object.assign(new TFile(), { path });
    files.set(path, file);
    return file;
  };
  return { render, open, getLeaf, setIds: (next: IdEntry[]) => (ids = next), addFile };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("reading links resolve on press", () => {
  it("keeps the number in data-jd and opens the note the index has NOW, not the one at render time", async () => {
    const t = setup([entry("21.22", "Old name")]);
    const el = t.render("<p>ver 21.22 aquí</p>");
    const link = el.querySelector<HTMLElement>("a.jdex-number-link")!;
    expect(link.dataset.jd).toBe("21.22");
    // The note is renamed after the page was rendered.
    t.setIds([entry("21.22", "New name")]);
    const renamed = t.addFile("J/21.22 New name.md");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(t.open).toHaveBeenCalledTimes(1));
    expect(t.open).toHaveBeenCalledWith(renamed);
  });

  it("stops the click so Obsidian never follows the stale data-href (which could create a note)", () => {
    const t = setup([entry("21.22", "Old name")]);
    const el = t.render("<p>21.22</p>");
    const link = el.querySelector<HTMLElement>("a.jdex-number-link")!;
    const outer = vi.fn();
    document.body.addEventListener("click", outer);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    document.body.removeEventListener("click", outer);
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it("does not open or create anything when the ID is gone", async () => {
    const t = setup([entry("21.22", "Gone")]);
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    t.setIds([]);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(t.getLeaf).not.toHaveBeenCalled();
  });

  it("two + children share a number: asks which one instead of opening the last", async () => {
    const a = entry("21.22+", "Alpha");
    const b = entry("21.22+", "Beta");
    const choose = vi.fn(async (entries: IdEntry[]) => entries[0]);
    const t = setup([b, a], { choose });
    const first = t.addFile(a.notePath!);
    t.addFile(b.notePath!);
    const link = t.render("<p>mira 21.22+ ahora</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    expect(link.classList.contains("internal-link")).toBe(false);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(t.open).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls[0][0].map((e) => e.label)).toEqual(["21.22+ Alpha", "21.22+ Beta"]);
    expect(t.open).toHaveBeenCalledWith(first);
  });

  it("a cancelled choice opens nothing", async () => {
    const t = setup([entry("21.22+", "Alpha"), entry("21.22+", "Beta")], { choose: async () => null });
    t.addFile("J/21.22+ Alpha.md");
    const link = t.render("<p>21.22+</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.open).not.toHaveBeenCalled();
  });

  it("a name with # resolves through the vault path, not through a link path", async () => {
    const e = entry("21.22", "Plan #1");
    const t = setup([e]);
    const file = t.addFile(e.notePath!);
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    // No internal-link: Obsidian would split the name at # and look for a heading.
    expect(link.classList.contains("internal-link")).toBe(false);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(t.open).toHaveBeenCalledWith(file));
  });

  it("a plain name keeps internal-link and data-href for the hover preview", () => {
    const t = setup([entry("21.22", "Plain")]);
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    expect(link.classList.contains("internal-link")).toBe(true);
    expect(link.dataset.href).toBe("21.22 Plain");
  });

  it("ctrl/cmd opens in a new tab", async () => {
    const e = entry("21.22", "Plain");
    const t = setup([e]);
    t.addFile(e.notePath!);
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    await vi.waitFor(() => expect(t.getLeaf).toHaveBeenCalledWith("tab"));
  });
});
