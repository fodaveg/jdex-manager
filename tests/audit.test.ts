import { describe, expect, it } from "vitest";
import { auditSystem, countProblems, type Finding, type FindingKind } from "../src/jd/audit";
import { buildIndex } from "../src/jd/index";
import { FILES, FOLDERS, JDEX, NOTES } from "./fixtures-audit";

const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: FILES });
const findings = auditSystem({ index, notes: NOTES, filePaths: FILES });
const of = (kind: FindingKind): Finding[] => findings.filter((f) => f.kind === kind);

describe("auditSystem", () => {
  it("finds exactly one case of each kind", () => {
    const counts = Object.fromEntries(
      [
        "folder-without-note",
        "note-without-folder",
        "name-mismatch",
        "frontmatter-mismatch",
        "duplicate-id",
        "reserved-used-as-content",
        "header-with-files",
        "out-of-parent",
      ].map((k) => [k, of(k as FindingKind).length]),
    );
    expect(counts).toEqual({
      "folder-without-note": 2,
      "note-without-folder": 3,
      "name-mismatch": 1,
      "frontmatter-mismatch": 1,
      "duplicate-id": 2,
      "reserved-used-as-content": 1,
      "header-with-files": 1,
      "out-of-parent": 2,
    });
  });

  it("folder without note and note without folder point at the right paths", () => {
    // 11.12 has no note; 11.15 is the duplicated folder pair, also without a note.
    expect(of("folder-without-note").map((f) => f.number).sort()).toEqual(["11.12", "11.15"]);
    expect(of("folder-without-note")[0].paths).toEqual(["10-19 Vida/11 Salud/11.12 Sin nota"]);
    // 11.14 on purpose; 11.16 and 11.17 are the frontmatter and duplicate cases, which have no folder either.
    const info = of("note-without-folder");
    expect(info.map((f) => f.number)).toEqual(["11.14", "11.16", "11.17"]);
    expect(info[0].paths).toEqual([`${JDEX}/11.14 Solo nota.md`]);
    expect(info.every((f) => f.informative)).toBe(true);
  });

  it("name mismatch proposes renaming the folder after the note", () => {
    const f = of("name-mismatch")[0];
    expect(f.number).toBe("11.13");
    expect(f.fix).toEqual({
      type: "rename",
      from: "10-19 Vida/11 Salud/11.13 Carpeta con otro nombre",
      to: "10-19 Vida/11 Salud/11.13 Nota con un nombre",
    });
  });

  it("frontmatter mismatch lists only the wrong fields with their expected values", () => {
    const f = of("frontmatter-mismatch")[0];
    expect(f.paths).toEqual([`${JDEX}/11.16 Frontmatter mal.md`]);
    expect(f.fix).toEqual({
      type: "frontmatter",
      path: `${JDEX}/11.16 Frontmatter mal.md`,
      set: { jd: "11.16", tipo: "id", categoria: "11 Salud" },
    });
  });

  it("duplicates are reported among notes and among folders", () => {
    const dup = of("duplicate-id");
    expect(dup.map((d) => d.number).sort()).toEqual(["11.15", "11.17"]);
    expect(dup.find((d) => d.number === "11.17")?.paths).toHaveLength(2);
  });

  it("reserved numbers with content: 00.03 with a PDF, but not .01 inbox, .09 archive, notes or attachments", () => {
    const f = of("reserved-used-as-content")[0];
    expect(f.number).toBe("00.03");
    expect(f.paths).toContain("00-09 Sistema/00 Sistema/00.03 Plantillas/factura-colada.pdf");
    expect(f.paths).not.toContain("00-09 Sistema/00 Sistema/00.03 Plantillas/70 Adjuntos/imagen.jpg");
  });

  it("header with files and numbers out of their parent", () => {
    expect(of("header-with-files")[0].number).toBe("11.10");
    expect(of("out-of-parent").map((f) => f.paths[0]).sort()).toEqual([
      "10-19 Vida/11 Salud/12.31 Fuera de sitio",
      "10-19 Vida/35 Categoría fuera de área",
    ]);
  });

  it("does not flag deep sub-folders inside an ID, nor the clean ID", () => {
    const touching = findings.filter((f) => f.paths.some((p) => p.includes("11.11 Limpio")));
    expect(touching).toEqual([]);
  });

  it("counts problems without the informative ones, and can promote them", () => {
    expect(countProblems(findings)).toBe(findings.length - 3);
    const strict = auditSystem({ index, notes: NOTES, filePaths: FILES, options: { noteWithoutFolderIsFinding: true } });
    expect(countProblems(strict)).toBe(strict.length);
  });

  it("is silent on a clean system", () => {
    const clean = buildIndex({
      systemRoot: "",
      folderPaths: ["10-19 Vida", "10-19 Vida/11 Salud", "10-19 Vida/11 Salud/11.11 Limpio"],
      jdexFolder: "JDex",
      notePaths: ["JDex/11.11 Limpio.md"],
    });
    const out = auditSystem({
      index: clean,
      notes: [{ path: "JDex/11.11 Limpio.md", frontmatter: { jd: "11.11", tipo: "id", area: "10-19 Vida", categoria: "11 Salud" } }],
      filePaths: ["JDex/11.11 Limpio.md"],
    });
    expect(out).toEqual([]);
  });
});
