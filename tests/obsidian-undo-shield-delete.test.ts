/**
 * Code review of 12 Oct 2026, finding 5: undoing «Create ID» trashes the note; the delete event
 * then regenerated the header lists and journaled a new operation that became the last one.
 * `onDelete` now leaves alone what an undo is restoring, like `onCreate`, renames and maintenance.
 */
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/jd/settings";
import { UndoShield } from "../src/vault/journal-store";

function plugin() {
  let now = 0;
  const shield = new UndoShield(1500, () => now);
  const p = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
    settings: mergeSettings({ jdexFolder: "J" }),
    unloaded: false,
    shield,
  }) as unknown as JdexManagerPlugin;
  const refresh = vi.spyOn(p, "refreshHeaders").mockResolvedValue(undefined);
  return { p, shield, refresh, tick: (ms: number) => { now += ms; } };
}

const note = (path: string) => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1) });

describe("Deleting a JDex note while an undo settles (finding 5)", () => {
  it("does not regenerate header lists for a note the undo trashed", async () => {
    const { p, shield, refresh, tick } = plugin();
    shield.start(["J/21.11 New.md"]);
    await p.onDelete(note("J/21.11 New.md"));
    shield.finish();
    tick(100);
    await p.onDelete(note("J/21.11 New.md"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("control: a delete after the undo settled, or of a note the undo did not touch, still refreshes", async () => {
    const { p, shield, refresh, tick } = plugin();
    shield.start(["J/21.11 New.md"]);
    await p.onDelete(note("J/21.12 Other.md"));
    expect(refresh).toHaveBeenCalledTimes(1);
    shield.finish();
    tick(2000);
    await p.onDelete(note("J/21.11 New.md"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
