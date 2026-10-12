/**
 * Code review of 12 Oct 2026, finding 7 (decided): automatic operations (maintenance, live header
 * lists, dating a new file) filled the 20 journal entries and pushed the user's out. They are now
 * marked automatic and have their own quota (10) that does not count against the user's 20.
 * Undo still undoes the last operation, whatever its kind.
 */
import { describe, expect, it, vi } from "vitest";
import { type Effect, JOURNAL_AUTO_MAX, JOURNAL_MAX, mergeJournals, type Operation } from "../src/jd/journal";
import { mergeSettings } from "../src/jd/settings";
import JdexManagerPlugin from "../src/main";
import { PluginDataFile } from "../src/vault/journal-store";
import { fakeVault } from "./support/fake-obsidian-vault";

const created = (path: string): Effect => ({ kind: "created-note", path, content: path });

function dataFile() {
  let stored: unknown = null;
  const io = { load: vi.fn(async (): Promise<unknown> => (stored === null ? null : JSON.parse(JSON.stringify(stored)) as unknown)), save: vi.fn(async (data: unknown) => { stored = JSON.parse(JSON.stringify(data)); }) };
  const data = new PluginDataFile(io, mergeSettings(null), "dev-A");
  return { data, stored: () => stored as { journal: Operation[] } };
}

describe("Automatic operations have their own journal quota (finding 7)", () => {
  it("30 automatic passes do not push out an operation of the user", async () => {
    const { data, stored } = dataFile();
    await data.load();
    const user = data.journal.begin("create-id", "Create 21.11 Mine");
    user.push(created("J/21.11 Mine.md"));
    await user.flush();
    for (let i = 0; i < 30; i += 1) {
      const pass = data.journal.begin("fix", `Automatic JDex maintenance ${i}`, true);
      pass.push(created(`J/auto-${i}.md`));
      await pass.flush();
    }
    const labels = data.journal.entries.map((op) => op.label);
    expect(labels).toContain("Create 21.11 Mine");
    expect(data.journal.entries.filter((op) => op.auto)).toHaveLength(JOURNAL_AUTO_MAX);
    // On disk too, and after loading it again.
    expect(stored().journal.map((op) => op.label)).toContain("Create 21.11 Mine");
    const again = dataFile();
    await again.data.load();
    expect(again.data.journal.entries).toEqual([]);
    const reloaded = new PluginDataFile({ load: async () => JSON.parse(JSON.stringify(stored())) as unknown, save: async () => {} }, mergeSettings(null), "dev-A");
    await reloaded.load();
    expect(reloaded.journal.entries.map((op) => op.label)).toContain("Create 21.11 Mine");
    // Undo still targets the last operation, which is automatic here.
    expect(data.journal.last()?.label).toBe("Automatic JDex maintenance 29");
  });

  it("the user's 20 are still the limit for the user's operations, and a merge keeps both quotas", () => {
    const at = (i: number) => `2026-10-12T00:00:${String(i).padStart(2, "0")}.000Z`;
    const ops: Operation[] = [];
    for (let i = 0; i < 25; i += 1) ops.push({ id: `u${i}`, kind: "create-id", label: `U${i}`, at: at(i), effects: [created(`u${i}`)] });
    for (let i = 0; i < 15; i += 1) ops.push({ id: `a${i}`, kind: "fix", label: `A${i}`, at: at(30 + i), effects: [created(`a${i}`)], auto: true });
    const merged = mergeJournals({ entries: [], removed: [] }, { entries: ops, removed: [] });
    expect(merged.entries.filter((op) => !op.auto).map((op) => op.id)).toEqual(ops.slice(5, 25).map((op) => op.id));
    expect(merged.entries.filter((op) => op.auto)).toHaveLength(JOURNAL_AUTO_MAX);
    expect(merged.entries).toHaveLength(JOURNAL_MAX + JOURNAL_AUTO_MAX);
    expect(merged.removed).toEqual(expect.arrayContaining(["u0", "u4", "a0", "a4"]));
  });
});

describe("The plugin marks what it writes on its own as automatic (finding 7)", () => {
  it("live header lists and the system index after a creation are automatic; the commands are not", async () => {
    const v = fakeVault();
    v.folder("J");
    const p = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
      app: v.app,
      settings: mergeSettings({ jdexFolder: "J" }),
      unloaded: false,
    }) as unknown as JdexManagerPlugin;
    const begin = vi.spyOn(p, "journalOperation").mockImplementation(() => Object.assign([] as Effect[], { flush: async () => {} }) as unknown as ReturnType<JdexManagerPlugin["journalOperation"]>);
    await p.refreshHeaders("21", false);
    await p.refreshHeaders(undefined, true);
    await p.refreshSystemIndex(false);
    await p.refreshSystemIndex(true);
    expect(begin.mock.calls.map((call) => call[2])).toEqual([true, false, true, false]);
  });
});
