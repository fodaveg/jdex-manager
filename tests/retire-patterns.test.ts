import { describe, expect, it } from "vitest";
import { auditSystem } from "../src/jd/audit";
import { buildIndex, findId } from "../src/jd/index";
import { formatCategoryPatterns, missingPatternFolders, parseCategoryPatterns, patternFor } from "../src/jd/patterns";
import { insertAfterH1, retirePlan } from "../src/jd/retire";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const ARCHIVE = "20-29 Trabajo y productos/21 Productos de software propios/21.09 Archivo de la categoría 21";
const index = buildIndex({
  systemRoot: "",
  folderPaths: [...FOLDERS, ARCHIVE],
  jdexFolder: JDEX,
  notePaths: [...NOTES, `${JDEX}/21.09 Archivo de la categoría 21.md`],
});

describe("retirePlan", () => {
  it("moves the folder to the archive with a date and marks the note", () => {
    const plan = retirePlan(index, findId(index, "21.22")!, "2026-09-10", "21.23 Sucesor");
    expect(plan).toMatchObject({
      id: "21.22",
      move: {
        from: "20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager",
        to: `${ARCHIVE}/2026-09-10 21.22 JDex Manager`,
      },
      frontmatter: { tipo: "archivado", archivado: "2026-09-10", destino: `${ARCHIVE}/2026-09-10 21.22 JDex Manager`, reemplazado_por: "21.23 Sucesor" },
    });
    expect("line" in plan && plan.line).toContain("Retirado el 2026-09-10.");
    expect("line" in plan && plan.line).toContain("[[21.23 Sucesor]]");
  });

  it("reports when the archive folder is missing and refuses ids without a note", () => {
    const noArchive = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: NOTES });
    const plan = retirePlan(noArchive, findId(noArchive, "21.22")!, "2026-09-10");
    expect("moveProblem" in plan && plan.moveProblem).toContain("21.09 has no folder");
    expect("move" in plan && plan.move).toBeUndefined();
    expect(retirePlan(index, { id: "21.11", category: "21", title: "x", label: "21.11 x", folderPath: "a" }, "2026-09-10")).toHaveProperty("error");
  });

  it("inserts the line after the H1, past the frontmatter", () => {
    expect(insertAfterH1("---\njd: x\n---\n# 21.22 T\n\nbody", "Retirado.")).toBe("---\njd: x\n---\n# 21.22 T\nRetirado.\n\nbody");
    expect(insertAfterH1("sin título", "Retirado.")).toBe("Retirado.\nsin título");
  });

  it("audit leaves a retired note alone", () => {
    const f = auditSystem({
      index: buildIndex({ systemRoot: "", folderPaths: [], jdexFolder: "J", notePaths: ["J/21.22 Viejo.md"] }),
      notes: [{ path: "J/21.22 Viejo.md", frontmatter: { jd: "21.22", tipo: "archivado", descripcion: "x" } }],
      filePaths: [],
    });
    expect(f.filter((x) => x.kind === "note-without-folder" || x.kind === "frontmatter-mismatch")).toEqual([]);
  });
});

describe("subfolder patterns", () => {
  const settings = { subfolderPattern: "70 Adjuntos\n", subfolderPatternsByCategory: { "21": "40 Audits y revisiones\n70 Adjuntos" } };

  it("parses and formats the per-category text", () => {
    expect(parseCategoryPatterns("21: 40 Audits, 70 Adjuntos\nbad line\n11:  70 Adjuntos ")).toEqual({ "21": "40 Audits\n70 Adjuntos", "11": "70 Adjuntos" });
    expect(formatCategoryPatterns({ "21": "40 Audits\n70 Adjuntos", "11": "70 Adjuntos" })).toBe("11: 70 Adjuntos\n21: 40 Audits, 70 Adjuntos");
  });

  it("uses the category override or the default", () => {
    expect(patternFor(settings, "21")).toEqual(["40 Audits y revisiones", "70 Adjuntos"]);
    expect(patternFor(settings, "11")).toEqual(["70 Adjuntos"]);
    expect(patternFor({ subfolderPattern: "", subfolderPatternsByCategory: {} }, "11")).toEqual([]);
  });

  it("finds missing pattern folders and the audit proposes creating them", () => {
    const folder = "20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager";
    expect(missingPatternFolders(folder, ["40 Audits y revisiones", "70 Adjuntos"], FOLDERS)).toEqual([`${folder}/70 Adjuntos`]);
    const f = auditSystem({ index, notes: [], filePaths: [], folderPaths: [...FOLDERS, ARCHIVE], patternFor: (c) => patternFor(settings, c) }).filter(
      (x) => x.kind === "pattern-missing",
    );
    expect(f.map((x) => x.number)).toEqual(["21.11", "21.22"]); // 11.11 already has 70 Adjuntos
    expect(f.find((x) => x.number === "21.22")?.fix).toEqual({ type: "folders", paths: [`${folder}/70 Adjuntos`] });
    expect(f.every((x) => x.informative)).toBe(true);
  });
});
