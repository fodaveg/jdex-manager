import { describe, expect, it } from "vitest";
import { categoryOfPath, datedName, directFiles, formatDate, idFolderOfPath, inboxFolders, isDatable, isDated, zeroOf } from "../src/jd/files";
import { buildIndex } from "../src/jd/index";
import { FOLDERS, JDEX, NOTES, REPORTS, TEMPLATES } from "./fixtures";

const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: NOTES });
const settings = { jdexFolder: JDEX, templatesFolder: TEMPLATES, reportsFolder: REPORTS };
const ID = "20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager";

describe("categoryOfPath", () => {
  it("reads the category from the path and rejects files outside the system", () => {
    expect(categoryOfPath("", `${ID}/Backlog.md`)).toBe("21");
    expect(categoryOfPath("", `${JDEX}/21.22 JDex Manager.md`)).toBe("00");
    expect(categoryOfPath("", "00 - fodaveg/x.md")).toBeNull();
    expect(categoryOfPath("", "Suelto.md")).toBeNull();
    expect(categoryOfPath("Sistema", `Sistema/${ID}/a.md`)).toBe("21");
  });
});

describe("idFolderOfPath, inboxFolders, zeroOf", () => {
  it("finds the ID folder that contains a file, at any depth", () => {
    expect(idFolderOfPath(index, `${ID}/40 Audits y revisiones/x.md`)?.id).toBe("21.22");
    expect(idFolderOfPath(index, "20-29 Trabajo y productos/21 Productos de software propios/suelto.md")).toBeNull();
  });

  it("lists inbox folders and finds zeros by category", () => {
    expect(inboxFolders(index).map((e) => e.id)).toEqual(["00.01"]);
    expect(zeroOf(index, "00", "01")?.folderPath).toBe("00-09 Gestión del sistema/00 Gestión del sistema/00.01 Inbox temporal");
    expect(zeroOf(index, "21", "09")).toBeUndefined();
  });
});

describe("dates", () => {
  it("detects existing prefixes and adds one otherwise", () => {
    expect(isDated("2026-09-10 nota.md")).toBe(true);
    expect(isDated("2026-09 nota.md")).toBe(true);
    expect(isDated("2024-08-15T213650Z.md")).toBe(true);
    expect(isDated("nota 2026-09-10.md")).toBe(false);
    const when = new Date(2026, 8, 10);
    expect(datedName("factura.pdf", when, "YYYY-MM-DD")).toBe("2026-09-10 factura.pdf");
    expect(datedName("factura.pdf", when, "YYYY-MM")).toBe("2026-09 factura.pdf");
    expect(datedName("2025-01-01 factura.pdf", when, "YYYY-MM-DD")).toBe("2025-01-01 factura.pdf");
    expect(formatDate(new Date(2026, 0, 5), "YYYY-MM-DD")).toBe("2026-01-05");
  });

  it("only dates files inside a content ID", () => {
    expect(isDatable(index, settings, `${ID}/factura.pdf`)).toBe(true);
    expect(isDatable(index, settings, `${JDEX}/21.22 JDex Manager.md`)).toBe(false);
    expect(isDatable(index, settings, `${TEMPLATES}/TEMPLATE - Libros.md`)).toBe(false);
    expect(isDatable(index, settings, "00-09 Gestión del sistema/00 Gestión del sistema/00.01 Inbox temporal/cosa.pdf")).toBe(false);
    expect(isDatable(index, settings, "Suelto.md")).toBe(false);
  });
});

describe("directFiles", () => {
  it("returns shallow children only", () => {
    expect(directFiles("a/b", ["a/b/x.md", "a/b/c/y.md", "a/bb/z.md", "a/b"])).toEqual(["a/b/x.md"]);
  });
});
