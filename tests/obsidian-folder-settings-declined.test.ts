/**
 * Code review of 12 Oct 2026, finding 11: Obsidian emits a rename for the folder and one per
 * descendant. After the user declined to follow a renamed JDex folder, the descendant's event
 * asked the same question again. The answer is now remembered for that rename during the session.
 */
import { describe, expect, it, vi } from "vitest";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/jd/settings";
import { fakeVault } from "./support/fake-obsidian-vault";

const answer = vi.hoisted(() => ({ value: false, asked: [] as string[][] }));
vi.mock("../src/ui/confirm", () => ({
  confirm: async (_app: unknown, _title: string, lines: string[]) => {
    answer.asked.push(lines);
    return answer.value;
  },
}));

function setup() {
  const v = fakeVault();
  for (const path of ["Sys2", "Sys2/00.00 JDex", "Sys2/00.02 Informes"]) v.folder(path);
  const p = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
    app: v.app,
    settings: mergeSettings({ jdexFolder: "Sys/00.00 JDex", reportsFolder: "Sys/00.02 Informes" }),
    renaming: false,
    unloaded: false,
    saveData: vi.fn(async () => {}),
    loadData: async () => null,
  }) as unknown as JdexManagerPlugin;
  const folder = (path: string) => v.app.vault.getAbstractFileByPath(path)!;
  return { p, folder };
}

describe("A declined folder-settings update is not asked again for each descendant (finding 11)", () => {
  it("asks once for the renamed ancestor and not again for its descendants", async () => {
    answer.value = false;
    answer.asked = [];
    const { p, folder } = setup();
    // Obsidian: the folder first, then each descendant.
    await p.onRename(folder("Sys2"), "Sys");
    await p.onRename(folder("Sys2/00.00 JDex"), "Sys/00.00 JDex");
    await p.onRename(folder("Sys2/00.02 Informes"), "Sys/00.02 Informes");
    expect(answer.asked).toHaveLength(1);
    expect(p.settings.jdexFolder).toBe("Sys/00.00 JDex");
  });

  it("control: a rename to another destination is asked again, and accepting it still works", async () => {
    answer.value = false;
    answer.asked = [];
    const { p, folder } = setup();
    await p.onRename(folder("Sys2/00.00 JDex"), "Sys/00.00 JDex");
    answer.value = true;
    await p.onRename(folder("Sys2"), "Sys/00.00 JDex");
    expect(answer.asked).toHaveLength(2);
    expect(p.settings.jdexFolder).toBe("Sys2");
  });
});
