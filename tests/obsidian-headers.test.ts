import { describe, expect, it } from "vitest";
import { type App, TFile } from "obsidian";
import { buildIndex } from "../src/jd/index";
import { applyHeaderWraps, headersToMigrate } from "../src/vault/headers";

const JDEX = "00.00 JDex";
const HEADER_PATH = `${JDEX}/21.10 ■ Cabecera.md`;
const BODY = "# 21.10 ■ Cabecera\n\n- [[21.11 Hebra]]\n";

function file(path: string): TFile {
  return Object.assign(new TFile(), { path, basename: path.slice(path.lastIndexOf("/") + 1, -3) });
}

/** A vault with one note whose content `edit` can change between preview and apply. */
function vaultWith(content: string) {
  const header = file(HEADER_PATH);
  const state = { content };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === HEADER_PATH ? header : null),
      read: async () => state.content,
      process: async (_file: TFile, update: (current: string) => string) => {
        state.content = update(state.content);
        return state.content;
      },
      modify: async () => {
        throw new Error("migrateHeaders must not call vault.modify");
      },
    },
  } as unknown as App;
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
