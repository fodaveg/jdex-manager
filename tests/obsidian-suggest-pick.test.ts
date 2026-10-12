// @vitest-environment happy-dom
/**
 * Code review of 12 Oct 2026, finding 9: Obsidian's `SuggestModal.selectSuggestion` closes the
 * modal (running `onClose`) BEFORE calling `onChooseSuggestion`. The three pickers that resolved
 * `null` in `onClose` (reading-view «Which one?», the category picker of «Send to inbox/archive» and
 * the ID picker of «Move to ID») therefore lost every choice. The stub now picks in that order.
 */
import { describe, expect, it, vi } from "vitest";
import { type PluginManifest, SuggestModal } from "obsidian";
import JdexManagerPlugin from "../src/main";
import type { CategoryEntry, IdEntry, JdIndex } from "../src/jd/index";
import type { ReadingLinksContext } from "../src/vault/reading-links";
import type { FlowPorts } from "../src/vault/flows";
import { closeTrackedModals } from "../src/ui/modal-registry";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";

const captured = vi.hoisted(() => ({ ctx: null as ReadingLinksContext | null }));
vi.mock("../src/vault/reading-links", () => ({
  registerReadingLinks: (_plugin: unknown, ctx: ReadingLinksContext) => { captured.ctx = ctx; },
}));

const entry = (id: string, title: string): IdEntry => ({ id, category: id.slice(0, 2), title, label: `${id} ${title}`, notePath: `J/${id} ${title}.md` });
const category: CategoryEntry = { number: "21", label: "21 Cat", areaNumber: 20, path: "20-29 Area/21 Cat" } as CategoryEntry;
const index = { ids: [entry("21.11", "A"), entry("21.11", "B")], categories: [category], areas: [] } as unknown as JdIndex;

/** Catches the next suggest modal the plugin opens, without rendering it. */
function nextModal(): () => SuggestModal<unknown> {
  const opened: SuggestModal<unknown>[] = [];
  // The stub's `isOpen` (not in Obsidian's typings): `close` only runs `onClose` on an open modal.
  const open = vi.spyOn(SuggestModal.prototype, "open").mockImplementation(function (this: SuggestModal<unknown>) {
    opened.push(Object.assign(this, { isOpen: true }));
  });
  return () => {
    open.mockRestore();
    if (opened.length === 0) throw new Error("no suggest modal opened");
    return opened[0];
  };
}

const enter = () => new KeyboardEvent("keydown", { key: "Enter" });

async function loadedPlugin() {
  const v = new FakeObsidianVault();
  v.setLayoutReady(false);
  const plugin = new JdexManagerPlugin(v.app, {} as PluginManifest);
  const bar = () => ({ addClass: vi.fn(), setText: vi.fn() });
  Object.assign(plugin, {
    loadData: async () => ({ jdexFolder: "J" }),
    saveData: vi.fn(async () => {}),
    addSettingTab: vi.fn(), addStatusBarItem: bar, registerDomEvent: vi.fn(), registerView: vi.fn(),
    addRibbonIcon: vi.fn(), registerEditorSuggest: vi.fn(), addCommand: vi.fn(),
  });
  await plugin.onload();
  return plugin;
}

function ports(plugin: JdexManagerPlugin): FlowPorts {
  return (plugin as unknown as { flowPorts(): FlowPorts }).flowPorts();
}

describe("Pickers keep the choice although Obsidian closes the modal first (finding 9)", () => {
  it("reading view «Which one?» resolves with the chosen entry", async () => {
    await loadedPlugin();
    const caught = nextModal();
    const choice = captured.ctx!.choose!(index.ids);
    caught().selectSuggestion(index.ids[1], enter());
    expect(await choice).toBe(index.ids[1]);
    closeTrackedModals();
  });

  it("the ID picker of «Move to ID» resolves with the chosen entry", async () => {
    const plugin = await loadedPlugin();
    const caught = nextModal();
    const choice = ports(plugin).pickEntry(index, "Move to…", "move here");
    caught().selectSuggestion(index.ids[0], enter());
    expect(await choice).toBe(index.ids[0]);
  });

  it("the category picker of «Send to inbox/archive» resolves with the chosen category", async () => {
    const plugin = await loadedPlugin();
    const caught = nextModal();
    const choice = ports(plugin).pickCategory(index);
    caught().selectSuggestion(category, enter());
    expect(await choice).toBe("21");
  });

  it("control: dismissing a picker still resolves null", async () => {
    const plugin = await loadedPlugin();
    const caught = nextModal();
    const choice = ports(plugin).pickEntry(index, "Move to…", "move here");
    caught().close();
    expect(await choice).toBeNull();
  });
});
