// @vitest-environment happy-dom
/* These tests run against happy-dom's own `document`, not an Obsidian window, so the popout-window rules do not apply. */
/* eslint-disable @typescript-eslint/unbound-method, obsidianmd/prefer-active-doc, obsidianmd/prefer-create-el, no-unsanitized/property, @microsoft/sdl/no-inner-html */
/**
 * Code review of 12 Oct 2026, finding 8: a number in reading view only answered `click`. The
 * middle button (`auxclick`) fell through to Obsidian, which follows the destination fixed at
 * render time; and the variant without `href` (focusable with tabIndex 0) did nothing on Enter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import type { IdEntry, JdIndex } from "../src/jd/index";
import { registerReadingLinks } from "../src/vault/reading-links";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

function entry(id: string, title: string): IdEntry {
  const label = `${id} ${title}`;
  return { id, category: id.slice(0, 2), title, label, notePath: `J/${label}.md`, folderPath: `A/${label}` };
}

function setup(initial: IdEntry[]) {
  let ids = initial;
  const v = new FakeObsidianVault();
  let process: ((el: HTMLElement) => void) | undefined;
  const plugin = { registerMarkdownPostProcessor: (fn: (el: HTMLElement) => void) => { process = fn; }, app: v.app } as unknown as Plugin;
  registerReadingLinks(plugin, { index: () => ({ ids } as unknown as JdIndex), enabled: () => true });
  const render = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.append(el);
    process!(el);
    return el;
  };
  return { v, render, setIds: (next: IdEntry[]) => (ids = next) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Middle click on a number (finding 8)", () => {
  it("opens the note the index has now in a new tab and stops Obsidian's handler", async () => {
    const t = setup([entry("21.22", "Old name")]);
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    t.setIds([entry("21.22", "New name")]);
    const renamed = t.v.file("J/21.22 New name.md");
    const outer = vi.fn();
    document.body.addEventListener("auxclick", outer);
    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    link.dispatchEvent(event);
    document.body.removeEventListener("auxclick", outer);
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(t.v.openFile).toHaveBeenCalledWith(renamed));
    expect(t.v.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
  });

  it("control: the right button is left to Obsidian (context menu)", async () => {
    const t = setup([entry("21.22", "Name")]);
    t.v.file("J/21.22 Name.md");
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
    link.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(false);
    expect(t.v.openFile).not.toHaveBeenCalled();
  });
});

describe("Enter on a number without href (finding 8)", () => {
  it("opens the note, like a click", async () => {
    // A `#` in the name cannot go into a link path: this variant has no href and tabIndex 0.
    const t = setup([entry("21.22", "C# notes")]);
    const note = t.v.file("J/21.22 C# notes.md");
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.tabIndex).toBe(0);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(t.v.openFile).toHaveBeenCalledWith(note));
  });

  it("control: Enter on the variant with href is left to the browser, which turns it into a click", async () => {
    const t = setup([entry("21.22", "Name")]);
    t.v.file("J/21.22 Name.md");
    const link = t.render("<p>21.22</p>").querySelector<HTMLElement>("a.jdex-number-link")!;
    expect(link.hasAttribute("href")).toBe(true);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(false);
    expect(t.v.openFile).not.toHaveBeenCalled();
  });
});
