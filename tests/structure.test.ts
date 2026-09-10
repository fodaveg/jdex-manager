import { describe, expect, it } from "vitest";
import { buildIndex, childrenPlus, findId } from "../src/jd/index";
import { managementCategoryName, nextFreeArea, nextFreeHeader, parseNewArea, standardZeroNames, validateNewCategory } from "../src/jd/structure";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const index = buildIndex({
  systemRoot: "",
  folderPaths: FOLDERS,
  jdexFolder: JDEX,
  notePaths: [...NOTES, `${JDEX}/21.22+ Hija uno.md`, `${JDEX}/21.22+ Hija dos.md`],
});

describe("structure helpers", () => {
  it("proposes the next free area, skipping 00-09", () => {
    expect(nextFreeArea(index)).toBe(30);
    expect(parseNewArea(index, "30-39")).toEqual({ area: 30 });
    expect(parseNewArea(index, "30")).toEqual({ area: 30 });
    expect(parseNewArea(index, "20-29")).toEqual({ error: "20-29 already exists." });
    expect(parseNewArea(index, "00-09")).toEqual({ error: "00-09 is the system area." });
    expect(parseNewArea(index, "abc")).toHaveProperty("error");
  });

  it("validates a new category inside its area", () => {
    expect(validateNewCategory(index, 20, "23")).toBeNull();
    expect(validateNewCategory(index, 20, "21")).toBe("21 already exists.");
    expect(validateNewCategory(index, 20, "20")).toBe("20 is the management category of the area.");
    expect(validateNewCategory(index, 20, "31")).toBe("The category must be inside 20-29.");
    expect(validateNewCategory(index, 20, "2")).toBe("Type a two-digit category like 22.");
  });

  it("proposes the first free header of a category", () => {
    expect(nextFreeHeader(index, "11")).toBe("11.20");
    expect(nextFreeHeader(index, "21")).toBe("21.10");
  });

  it("names the standard zeros and the management category explicitly", () => {
    expect(standardZeroNames("22")).toEqual({
      inbox: { id: "22.01", title: "Inbox de la categoría 22" },
      archive: { id: "22.09", title: "Archivo de la categoría 22" },
    });
    expect(managementCategoryName(20)).toEqual({ number: "20", title: "Gestión del área 20-29" });
  });

  it("keeps several + children of one ID as separate entries", () => {
    expect(childrenPlus(index, "21.22").map((c) => c.title)).toEqual(["Hija dos", "Hija uno"]);
    expect(findId(index, "21.22")?.title).toBe("JDex Manager");
  });
});
