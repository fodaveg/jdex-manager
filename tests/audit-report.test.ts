import { describe, expect, it } from "vitest";
import { auditSystem } from "../src/jd/audit";
import { renderReport, reportFileName } from "../src/jd/audit-report";
import { buildIndex } from "../src/jd/index";
import { FILES, FOLDERS, JDEX, NOTES } from "./fixtures-audit";

const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: FILES });
const findings = auditSystem({ index, notes: NOTES, filePaths: FILES });

describe("renderReport", () => {
  const report = renderReport(findings, "2026-09-10");

  it("has frontmatter, title, summary table and one section per kind", () => {
    expect(report.startsWith("---\ntipo: auditoria\nfecha: 2026-09-10\nhallazgos: ")).toBe(true);
    expect(report).toContain("# Auditoría JD - 2026-09-10");
    expect(report).toContain("| Carpetas con ID sin nota en el JDex | 2 |");
    expect(report).toContain("| IDs duplicados | 2 |");
    expect(report).toContain("## Notas sin carpeta (informativo)");
    expect(report.indexOf("## Notas sin carpeta (informativo)")).toBeGreaterThan(report.indexOf("## Números fuera de su padre"));
    expect(report).toContain(`[[${JDEX}/11.14 Solo nota]]`);
  });

  it("links notes as wikilinks without .md and folders as code", () => {
    expect(report).toContain(`[[${JDEX}/11.13 Nota con un nombre]]`);
    expect(report).toContain("`10-19 Vida/11 Salud/11.12 Sin nota`");
    expect(report).toContain("arreglo mecánico disponible");
  });

  it("says Ninguno for empty sections and reports a clean system", () => {
    const clean = renderReport([], "2026-09-10");
    expect(clean).toContain("hallazgos: 0");
    expect(clean).toContain("Sin problemas.");
    expect(clean.match(/Ninguno\./g)).toHaveLength(11);
  });

  it("names the report file by date", () => {
    expect(reportFileName("2026-09-10")).toBe("Auditoría JD - 2026-09-10.md");
  });
});
