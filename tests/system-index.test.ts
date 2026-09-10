import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { appendIndexMarkers, INDEX_END, INDEX_START, renderSystemIndex, replaceSystemIndex } from "../src/jd/system-index";
import { FOLDERS, JDEX, NOTES } from "./fixtures";
import { auditSystem } from "../src/jd/audit";

const index = buildIndex({
  systemRoot: "",
  folderPaths: FOLDERS,
  jdexFolder: JDEX,
  notePaths: [...NOTES, `${JDEX}/11.14 Nueva.md`, `${JDEX}/21.22+ Hija.md`, `${JDEX}/20-29 Trabajo y productos.md`],
});

describe("renderSystemIndex", () => {
  const out = renderSystemIndex(index, new Map([[`${JDEX}/21.22 JDex Manager.md`, "el plugin"]]));
  const lines = out.split("\n");

  it("nests areas, categories, headers, ids and + children with descriptions", () => {
    expect(lines[0]).toBe("- 00-09 Gestión del sistema");
    expect(lines).toContain("- [[20-29 Trabajo y productos]]");
    expect(lines).toContain("  - 21 Productos de software propios");
    expect(lines).toContain("    - [[21.22 JDex Manager]] · el plugin");
    expect(lines).toContain("      - [[21.22+ Hija]]");
    expect(lines).toContain("    - [[11.10 ■ 🪪 Registros personales y legales]]");
    expect(lines).toContain("      - [[11.11 Identidad y documentos oficiales]]");
    expect(lines).toContain("      - [[11.14 Nueva]]");
    expect(lines.indexOf("      - [[11.11 Identidad y documentos oficiales]]")).toBeGreaterThan(lines.indexOf("    - [[11.10 ■ 🪪 Registros personales y legales]]"));
  });

  it("keeps ids without a header at category level", () => {
    expect(lines).toContain("    - [[00.11 Manual de la bóveda]]");
  });
});

describe("markers", () => {
  it("replaces between markers and appends them when missing", () => {
    const note = `# 00.00\n${INDEX_START}\nviejo\n${INDEX_END}\nfin`;
    expect(replaceSystemIndex(note, "- nuevo")).toBe(`# 00.00\n${INDEX_START}\n- nuevo\n${INDEX_END}\nfin`);
    expect(replaceSystemIndex("# sin", "- x")).toBeNull();
    const added = appendIndexMarkers("# 00.00\n");
    expect(added).toContain("## Índice del sistema");
    expect(replaceSystemIndex(added, "- x")).not.toBeNull();
  });
});

describe("audit: structure without note", () => {
  it("lists area and category folders without a JDex note, informative by default", () => {
    const f = auditSystem({ index, notes: [], filePaths: [] }).filter((x) => x.kind === "structure-without-note");
    expect(f.map((x) => x.number)).toEqual(["00-09", "10-19", "00", "11", "21", "22"]);
    expect(f.every((x) => x.informative)).toBe(true);
    const strict = auditSystem({ index, notes: [], filePaths: [], options: { structureNotesAreFindings: true } }).filter((x) => x.kind === "structure-without-note");
    expect(strict.every((x) => !x.informative)).toBe(true);
  });
});
