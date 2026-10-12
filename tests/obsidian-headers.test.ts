/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/jd/index";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { applyHeaderWraps, headersToMigrate } from "../src/vault/headers";

const JDEX = "00.00 JDex";
const HEADER_PATH = `${JDEX}/21.10 ■ Cabecera.md`;
const BODY = "# 21.10 ■ Cabecera\n\n- [[21.11 Hebra]]\n";

/** A vault with one note whose content `edit` can change between preview and apply. */
function vaultWith(content: string) {
  const v = new FakeObsidianVault();
  v.file(HEADER_PATH, content);
  // A rewrite goes through `process`; `modify` would replace the file without the atomic check.
  vi.mocked(v.app.vault.modify).mockRejectedValue(new Error("migrateHeaders must not call vault.modify"));
  const { app } = v;
  const state = { get content() { return v.bodies.get(HEADER_PATH)!; }, set content(value: string) { v.bodies.set(HEADER_PATH, value); } };
  const index = buildIndex({ systemRoot: "", jdexFolder: JDEX, folderPaths: [JDEX, "20-29 Productos", "20-29 Productos/21 Productos de software"], notePaths: [HEADER_PATH] });
  return { app, index, state };
}

describe("wrapping header lists in Obsidian", () => {
  it("the preview keeps the body it was computed from", async () => {
    const { app, index } = vaultWith(BODY);
    const todo = await headersToMigrate(app, index);
    expect(todo).toHaveLength(1);
    expect(todo[0].before).toBe(BODY);
    expect(todo[0].next).toContain("<!-- jdex:hijos -->");
  });

  it("skips a note edited after the preview and keeps the added line", async () => {
    const { app, index, state } = vaultWith(BODY);
    const todo = await headersToMigrate(app, index);
    state.content = `${BODY}- [[21.12 Añadida entretanto]]\n`;
    const result = await applyHeaderWraps(app, todo);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([HEADER_PATH]);
    expect(result.effects).toEqual([]);
    expect(state.content).toBe(`${BODY}- [[21.12 Añadida entretanto]]\n`);
  });

  it("control: without an edit it wraps and records a note-rewrite effect for the journal", async () => {
    const { app, index, state } = vaultWith(BODY);
    const todo = await headersToMigrate(app, index);
    const result = await applyHeaderWraps(app, todo);
    expect(result.written).toEqual([HEADER_PATH]);
    expect(result.skipped).toEqual([]);
    expect(state.content).toBe(todo[0].next);
    expect(result.effects).toEqual([{ kind: "note-rewrite", path: HEADER_PATH, before: BODY, after: todo[0].next }]);
  });
});
