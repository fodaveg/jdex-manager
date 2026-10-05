import { describe, expect, it } from "vitest";
import { areaCode, areaOfCategory, buildIndex, categoryUsage, findId, knownIds } from "../src/jd/index";
import { nextFreeId } from "../src/jd/parse";
import { auditSystem } from "../src/jd/audit";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: NOTES });

describe("buildIndex", () => {
  it("lists areas from the root folders and ignores non-JD folders", () => {
    expect(index.areas.map((a) => a.code)).toEqual(["00-09", "10-19", "20-29"]);
    expect(index.areas[2]).toMatchObject({ number: 20, label: "20-29 Trabajo y productos", path: "20-29 Trabajo y productos" });
  });

  it("lists categories only inside their own area", () => {
    expect(index.categories.map((c) => c.number)).toEqual(["00", "11", "21", "22"]);
    expect(index.categories.find((c) => c.label === "00 - fodaveg")).toBeUndefined();
    expect(index.categories.find((c) => c.number === "35")).toBeUndefined();
    expect(index.categories.find((c) => c.number === "21")).toMatchObject({
      areaNumber: 20,
      title: "Productos de software propios",
      label: "21 Productos de software propios",
      path: "20-29 Trabajo y productos/21 Productos de software propios",
    });
  });

  it("merges ids from JDex notes and system folders", () => {
    const manager = findId(index, "21.22");
    expect(manager).toMatchObject({
      category: "21",
      title: "JDex Manager",
      notePath: `${JDEX}/21.22 JDex Manager.md`,
      folderPath: "20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager",
    });
    expect(findId(index, "00.11")).toMatchObject({ notePath: `${JDEX}/00.11 Manual de la bóveda.md` });
    expect(findId(index, "00.11")?.folderPath).toBeUndefined();
    expect(findId(index, "21.21")?.folderPath).toBeUndefined();
    expect(findId(index, "11.10")?.title).toBe("■ 🪪 Registros personales y legales");
  });

  it("ignores id folders outside their category, sub-folders and notes outside the JDex", () => {
    expect(findId(index, "12.31")).toBeUndefined();
    expect(index.ids.find((e) => e.label.startsWith("70 "))).toBeUndefined();
    expect(index.ids.find((e) => e.label.startsWith("40 "))).toBeUndefined();
    expect(index.ids.find((e) => e.label === "Notas sueltas")).toBeUndefined();
  });

  it("feeds nextFreeId with every known id", () => {
    expect(nextFreeId("21", knownIds(index))).toBe("21.23");
    expect(nextFreeId("22", knownIds(index))).toBe("22.11");
    expect(nextFreeId("11", knownIds(index))).toBe("11.12");
  });

  it("reads categories and areas from JDex notes when there are no folders", () => {
    const only = buildIndex({
      systemRoot: "",
      folderPaths: [],
      jdexFolder: "JDex",
      notePaths: ["JDex/10-19 Vida.md", "JDex/11 Dinero.md", "JDex/11.11 Banco.md"],
    });
    expect(only.areas).toEqual([{ number: 10, code: "10-19", title: "Vida", label: "10-19 Vida", notePath: "JDex/10-19 Vida.md" }]);
    expect(only.categories[0]).toMatchObject({ number: "11", areaNumber: 10, label: "11 Dinero" });
    expect(only.categories[0].path).toBeUndefined();
  });

  it("honours a nested system root", () => {
    const nested = buildIndex({
      systemRoot: "Sistema",
      folderPaths: FOLDERS.map((p) => `Sistema/${p}`),
      jdexFolder: `Sistema/${JDEX}`,
      notePaths: NOTES.map((p) => `Sistema/${p}`),
    });
    expect(nested.categories.map((c) => c.number)).toEqual(["00", "11", "21", "22"]);
    expect(findId(nested, "21.22")?.folderPath).toBe(
      "Sistema/20-29 Trabajo y productos/21 Productos de software propios/21.22 JDex Manager",
    );
  });

  it("pairs fourth-level + folders with their child notes, ignoring trailing tags", () => {
    const parent = "20-29 Trabajo/21 Productos/21.22 JDex Manager";
    const child = `${parent}/+ Manual`;
    const childIndex = buildIndex({
      systemRoot: "Sistema",
      folderPaths: ["Sistema/20-29 Trabajo", "Sistema/20-29 Trabajo/21 Productos", `Sistema/${parent}`, `Sistema/${child}`],
      jdexFolder: "Sistema/JDex",
      notePaths: ["Sistema/JDex/21.22 JDex Manager.md", "Sistema/JDex/21.22+ Manual #jd-ayuda.md"],
    });
    expect(childIndex.ids.find((e) => e.id === "21.22+")).toMatchObject({
      title: "Manual #jd-ayuda",
      notePath: "Sistema/JDex/21.22+ Manual #jd-ayuda.md",
      folderPath: `Sistema/${child}`,
    });
    expect(childIndex.ids).toHaveLength(2);
    expect(auditSystem({ index: childIndex, notes: [], filePaths: [] }).filter((f) => f.kind === "note-without-folder" || f.kind === "folder-without-note")).toEqual([]);
  });

  it("audits an orphan + folder and ignores ordinary, deeper and unvalidated subfolders", () => {
    const parent = "20-29 Trabajo/21 Productos/21.22 JDex Manager";
    const child = `${parent}/+ Sin nota`;
    const childIndex = buildIndex({
      systemRoot: "",
      folderPaths: [
        "20-29 Trabajo", "20-29 Trabajo/21 Productos", parent, child,
        `${parent}/Documentos`, `${parent}/21.22+ No es un hijo`, `${child}/+ Demasiado profundo`,
        "20-29 Trabajo/21 Productos/Notas sueltas/+ Sin padre",
        "20-29 Trabajo/21 Productos/22.11 Fuera de categoría/+ Inválido",
      ],
      jdexFolder: "JDex",
      notePaths: ["JDex/21.22 JDex Manager.md"],
    });
    expect(childIndex.ids.map((e) => e.id)).toEqual(["21.22", "21.22+"]);
    expect(auditSystem({ index: childIndex, notes: [], filePaths: [] }).filter((f) => f.kind === "folder-without-note")).toEqual([
      expect.objectContaining({ number: "21.22+", paths: [child] }),
    ]);
  });
});

describe("helpers", () => {
  it("derives area codes", () => {
    expect(areaCode(0)).toBe("00-09");
    expect(areaCode(20)).toBe("20-29");
    expect(areaOfCategory("21")).toBe(20);
    expect(areaOfCategory("05")).toBe(0);
  });
});

describe("categoryUsage", () => {
  it("counts content ids out of 81 and names the next free one", () => {
    expect(categoryUsage(index, "21")).toEqual({ used: 3, total: 81, next: "21.23" });
    expect(categoryUsage(index, "11")).toEqual({ used: 1, total: 81, next: "11.12" });
    expect(categoryUsage(index, "22")).toEqual({ used: 0, total: 81, next: "22.11" });
  });
});
