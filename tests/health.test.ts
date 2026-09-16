import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { healthFileName, measureHealth, renderHealthReport } from "../src/jd/health";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: NOTES });
const LUMBRE = "20-29 Trabajo y productos/21 Productos de software propios/21.11 Lumbre";
const MANAGER = "20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager";
const files = [
  ...NOTES,
  `${LUMBRE}/a.md`,
  `${LUMBRE}/b.pdf`,
  `${LUMBRE}/c.png`,
  `${MANAGER}/40 Audits y revisiones/x.md`,
];

describe("measureHealth", () => {
  const h = measureHealth(index, files, { maxFiles: 2, nearlyFull: 1 });

  it("counts usage and files per category", () => {
    const c21 = h.categories.find((c) => c.number === "21")!;
    expect(c21.used).toBe(3);
    expect(c21.total).toBe(81);
    expect(c21.next).toBe("21.23");
    expect(c21.files).toBe(5);
  });

  it("lists categories over the threshold", () => {
    expect(h.nearlyFull.map((c) => c.number)).toEqual(["21"]);
  });

  it("finds empty and crowded ID folders", () => {
    expect(h.emptyIds.map((e) => e.id)).toEqual(["11.11"]);
    expect(h.crowdedIds.map((e) => [e.id, e.files])).toEqual([["21.11", 3]]);
  });
});

describe("renderHealthReport", () => {
  const md = renderHealthReport(index, files, "2026-09-16", { maxFiles: 2, nearlyFull: 1 });

  it("has frontmatter, the table and the sections", () => {
    expect(md.startsWith("---\ntipo: salud\nfecha: 2026-09-16\n")).toBe(true);
    expect(md).toContain("| 21 Productos de software propios | 3 / 81 | 21.23 | 5 |");
    expect(md).toContain("## Categorías con más de 1 IDs usados");
    expect(md).toContain("- [[21.11 Lumbre]]: 3 ficheros");
    expect(md).toContain("- [[11.11 Identidad y documentos oficiales]] · `");
  });

  it("says when a section is empty", () => {
    const clean = renderHealthReport(index, files, "2026-09-16");
    expect(clean).toContain("## Categorías con más de 70 IDs usados\n\nNinguna.");
    expect(clean).toContain("## IDs con más de 50 ficheros (candidatos a `+` o subcarpetas)\n\nNinguno.");
  });

  it("names the note by date", () => {
    expect(healthFileName("2026-09-16")).toBe("Salud JD - 2026-09-16.md");
  });
});
