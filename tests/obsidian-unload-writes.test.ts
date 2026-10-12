/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Code review of 12 Oct 2026, finding 10: writes after the plugin is unloaded. `onCreate` did not
 * check `unloaded` after its awaits, `refreshHeaders` did not check it at all, and `updateHeaders`
 * kept writing header notes one after another without looking at `stopped`.
 */
import { describe, expect, it, vi } from "vitest";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/jd/settings";
import { updateHeaders } from "../src/vault/headers";
import { scanVault } from "../src/vault/scan";
import { UndoShield } from "../src/vault/journal-store";
import { fakeVault } from "./support/fake-obsidian-vault";

const MARKERS = "<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n";

function vaultWithTwoHeaders() {
  const v = fakeVault();
  for (const path of ["J", "20-29 Area", "20-29 Area/21 Cat", "20-29 Area/22 Cat"]) v.folder(path);
  v.file("J/21.10 ■ Uno.md", `# 21.10 ■ Uno\n\n${MARKERS}`);
  v.file("J/21.11 Nota.md", "# 21.11 Nota\n");
  v.file("J/22.10 ■ Dos.md", `# 22.10 ■ Dos\n\n${MARKERS}`);
  v.file("J/22.11 Otra.md", "# 22.11 Otra\n");
  return v;
}

describe("updateHeaders stops between notes once stopped (finding 10)", () => {
  it("writes no further header note after the plugin is unloaded mid-pass", async () => {
    const v = vaultWithTwoHeaders();
    const index = scanVault(v.app, mergeSettings({ jdexFolder: "J" }));
    let unloaded = false;
    v.beforeWrite = () => { unloaded = true; };
    const changed = await updateHeaders(v.app, index, undefined, [], undefined, () => unloaded);
    expect(changed).toBe(1);
    expect(vi.mocked(v.app.vault.process)).toHaveBeenCalledTimes(1);
  });

  it("control: without stopping it writes both", async () => {
    const v = vaultWithTwoHeaders();
    const index = scanVault(v.app, mergeSettings({ jdexFolder: "J" }));
    expect(await updateHeaders(v.app, index, undefined, [], undefined, () => false)).toBe(2);
  });
});

function plugin() {
  const v = vaultWithTwoHeaders();
  const p = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
    app: v.app,
    settings: mergeSettings({ jdexFolder: "J", updateSystemIndexOnCreate: true, liveHeaders: true, dateOnCreate: false }),
    unloaded: false,
    shield: new UndoShield(),
    inboxBar: null,
  }) as unknown as JdexManagerPlugin;
  const unload = () => void Object.assign(p, { unloaded: true });
  return { v, p, unload };
}

describe("onCreate and refreshHeaders after unload (finding 10)", () => {
  it("onCreate does not refresh header lists when the plugin was unloaded during its previous await", async () => {
    const { v, p, unload } = plugin();
    vi.spyOn(p, "refreshSystemIndex").mockImplementation(async () => unload());
    const headers = vi.spyOn(p, "refreshHeaders").mockResolvedValue(undefined);
    await p.onCreate(v.app.vault.getAbstractFileByPath("J/21.11 Nota.md")!);
    expect(headers).not.toHaveBeenCalled();
  });

  it("control: still loaded, onCreate refreshes the header lists of the category", async () => {
    const { v, p } = plugin();
    vi.spyOn(p, "refreshSystemIndex").mockResolvedValue(undefined);
    const headers = vi.spyOn(p, "refreshHeaders").mockResolvedValue(undefined);
    await p.onCreate(v.app.vault.getAbstractFileByPath("J/21.11 Nota.md")!);
    expect(headers).toHaveBeenCalledWith("21", false);
  });

  it("refreshHeaders writes and journals nothing after unload", async () => {
    const { v, p, unload } = plugin();
    const journal = vi.spyOn(p, "journalOperation");
    unload();
    await p.refreshHeaders(undefined, false);
    expect(journal).not.toHaveBeenCalled();
    expect(vi.mocked(v.app.vault.process)).not.toHaveBeenCalled();
  });
});
