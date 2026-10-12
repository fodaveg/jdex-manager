// @vitest-environment happy-dom
/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- the stub and its DOM helpers run outside Obsidian: there is no activeDocument or createEl yet. */
import { describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { notices, resetStub } from "./support/obsidian-stub-api";

/** The stub's classes seen without the real typings, which mark most of them abstract and demand a real `App`. */
type Instance = Record<string, (...args: unknown[]) => unknown>;
const api = obsidian as unknown as Record<string, new (...args: unknown[]) => Instance>;
const dom = () => document.createElement("div");

describe("obsidian stub: members that are not modelled throw", () => {
  it.each([
    ["Plugin", "addCommand", () => new api.Plugin({}, {})],
    ["Plugin", "loadData", () => new api.Plugin({}, {})],
    ["Plugin", "registerView", () => new api.Plugin({}, {})],
    ["Modal", "setContent", () => new api.Modal({})],
    ["Setting", "addSlider", () => new api.Setting(dom())],
    ["Setting", "addTextArea", () => new api.Setting(dom())],
    ["SuggestModal", "getSuggestions", () => new api.SuggestModal({})],
    ["EditorSuggest", "onTrigger", () => new api.EditorSuggest({})],
    ["ItemView", "getViewType", () => new api.ItemView({})],
    ["AbstractInputSuggest", "setValue", () => new api.AbstractInputSuggest({}, {})],
  ])("%s.%s", (name, member, make) => {
    expect(() => make()[member]()).toThrow(`obsidian-stub: ${name}.${member} is not implemented`);
  });

  it("a member nobody modelled is absent: calling it is a TypeError, not a silent no-op", () => {
    const tab = new api.PluginSettingTab({}, {});
    expect(() => tab.somethingElse()).toThrow(TypeError);
  });

  it("a Notice records its message, and the rest of its API throws", () => {
    resetStub();
    const notice = new api.Notice("hello");
    expect(notices()).toEqual(["hello"]);
    expect(() => notice.hide()).toThrow("obsidian-stub: Notice.hide is not implemented");
  });

  it("a test can still override a throwing member: Object.assign, vi.spyOn and subclasses keep working", () => {
    const plugin = new api.Plugin({}, {});
    const addCommand = vi.fn();
    Object.assign(plugin, { addCommand });
    plugin.addCommand({ id: "x" });
    expect(addCommand).toHaveBeenCalledOnce();

    const modal = new api.Modal({});
    vi.spyOn(modal, "setContent").mockImplementation(() => undefined);
    expect(() => modal.setContent("a")).not.toThrow();

    class Mine extends api.SuggestModal {
      getSuggestions(query: unknown) { return [query]; }
    }
    expect(new Mine({}).getSuggestions("q")).toEqual(["q"]);
  });

  it("Modal exposes DOM elements under a DOM environment and lets a test replace them", () => {
    const modal = new api.Modal({}) as unknown as { contentEl: HTMLElement };
    expect(modal.contentEl).toBeInstanceOf(HTMLElement);
    modal.contentEl = document.createElement("section");
    expect(modal.contentEl.tagName).toBe("SECTION");
  });

  it("Modal.open runs onOpen once and close runs onClose only when it was open", () => {
    const calls: string[] = [];
    class Mine extends api.Modal {
      onOpen() { calls.push("open"); }
      onClose() { calls.push("close"); }
    }
    const modal = new Mine({});
    modal.close();
    modal.open();
    modal.close();
    modal.close();
    expect(calls).toEqual(["open", "close"]);
  });
});
