import { describe, expect, it } from "vitest";
import { auditSystem, countProblems, expectedFrontmatter } from "../src/jd/audit";
import { buildIndex, categoryUsage, childrenPlus, findId, knownIds, selectCreationSystem, selectSystem } from "../src/jd/index";
import { childrenOf } from "../src/jd/headers";
import { extractJdPrefix, isHeader, nextFreeId, parseJdNumber } from "../src/jd/parse";
import { pairAction } from "../src/jd/pair";
import { renderSystemIndex } from "../src/jd/system-index";

const indexOf = (folders: string[], notes: string[] = []) => buildIndex({ systemRoot: "", jdexFolder: "JDex", folderPaths: folders, notePaths: notes.map((n) => `JDex/${n}.md`) });
const settings = { systemRoot: "", jdexFolder: "JDex" };

describe("JD number integrity", () => {
  it("reports wrong structural depth without a mechanical fix and leaves valid hierarchy alone", () => {
    const index = indexOf(["20-29 Area", "20-29 Area/21 Category", "20-29 Area/21 Category/21.11 Valid", "20-29 Area/21.12 Wrong", "21 Root category", "21.13 Root ID", "20-29 Area/30-39 Nested area"]);
    const findings = auditSystem({ index, notes: [], filePaths: [] }).filter((f) => f.kind === "misplaced-number");
    expect(findings.map((f) => f.paths[0]).sort()).toEqual(["20-29 Area/21.12 Wrong", "21 Root category", "21.13 Root ID", "20-29 Area/30-39 Nested area"].sort());
    expect(countProblems(findings)).toBe(4);
    expect(findings.every((f) => f.fix === undefined)).toBe(true);
    expect(findId(index, "21.11")).toBeDefined();
  });

  it("reports short IDs in notes and folders and a square on a content ID without converting it to a header", () => {
    const index = indexOf(["20-29 Area", "20-29 Area/21 Category", "20-29 Area/21 Category/21.2 Short", "20-29 Area/21 Category/21.12 Valid"], ["21.2 Short", "21.23 ■ Content", "21.20 ■ Header"]);
    const malformed = auditSystem({ index, notes: [], filePaths: [] }).filter((f) => f.kind === "malformed-number");
    expect(malformed).toHaveLength(3);
    expect(malformed.some((f) => f.message.includes("■ en un ID que no acaba en 0"))).toBe(true);
    expect(malformed.every((f) => !f.fix && !f.informative)).toBe(true);
    expect(extractJdPrefix("21.2 Short")).toBeNull();
    expect(isHeader("21.23 ■ Content")).toBe(false);
    expect(expectedFrontmatter(index, parseJdNumber("21.23"), "21.23 ■ Content").tipo).toBe("id");
    expect(isHeader("21.20 ■ Header")).toBe(true);
  });

  it("keeps default, D01 and D02 numbering, parents, headers, titles and children separate", () => {
    const notes: string[] = [];
    const folders: string[] = [];
    for (const prefix of ["", "D01.", "D02."]) {
      const area = `${prefix}20-29 Area ${prefix || 'default'}`;
      const category = `${prefix}21 Category ${prefix || 'default'}`;
      const id = `${prefix}21.11 Title ${prefix || 'default'}`;
      folders.push(area, `${area}/${category}`, `${area}/${category}/${id}`, `${area}/${category}/${id}/+ Child`);
      notes.push(area, category, id, `${prefix}21.10 ■ Header`, `${prefix}21.11+ Child`);
    }
    notes.push("D01.21.19 Highest", "D02.21.11 Duplicate");
    const index = indexOf(folders, notes);
    expect(index.areas).toHaveLength(3);
    expect(index.categories).toHaveLength(3);
    expect(findId(index, "21.11")?.title).toBe("Title default");
    expect(findId(index, "D01.21.11")?.title).toBe("Title D01.");
    expect(childrenPlus(index, "21.11", "D01")).toHaveLength(1);
    expect(childrenPlus(index, "21.11", "D01")[0].folderPath).toContain("D01.20-29");
    expect(childrenOf(index, "21.10", "D01").map((e) => e.id)).toEqual(["21.11", "21.19"]);
    expect(childrenOf(index, "21.10").map((e) => e.title)).toEqual(["Title default"]);
    expect(categoryUsage(index, "21", "D01").next).toBe("21.21");
    expect(nextFreeId("21", knownIds(selectSystem(index, "D02")))).toBe("21.12");
    expect(nextFreeId("21", ["D01.21.99", "21.11"])).toBe("21.12");
    const duplicates = auditSystem({ index, notes: [], filePaths: [] }).filter((f) => f.kind === "duplicate-id");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].number).toBe("D02.21.11");
    const fm = expectedFrontmatter(index, parseJdNumber("D01.21.11"), "D01.21.11 X");
    expect(fm.area).toBe("D01.20-29 Area D01.");
    expect(fm.categoria).toBe("D01.21 Category D01.");
    const rendered = renderSystemIndex(index);
    expect(rendered.split("[[D01.21.11+ Child]]")).toHaveLength(2);
  });

  it("scopes malformed-number findings when auditing one system", () => {
    const index = indexOf([], ["21.2 Default", "D01.21.2 First", "D02.21.2 Second"]);
    const findings = auditSystem({ index: selectSystem(index, "D01"), notes: [], filePaths: [] });
    expect(findings.filter((f) => f.kind === "malformed-number").map((f) => f.paths[0])).toEqual(["JDex/D01.21.2 First.md"]);
  });

  it("keeps prefixed IDs under unprefixed physical scaffolding visible without borrowing default partners", () => {
    const parent = "20-29 Area/21 Category";
    const index = indexOf(["20-29 Area", parent, `${parent}/D01.21.11 Folder`, `${parent}/D01.21.11 Folder/+ Child`], ["21.11 Default", "D01.21.11 Actual", "D01.21.11+ Child"]);
    expect(findId(index, "21.11")?.folderPath).toBeUndefined();
    expect(findId(index, "D01.21.11")?.folderPath).toBe(`${parent}/D01.21.11 Folder`);
    expect(selectCreationSystem(index, "D01").categories[0]).toMatchObject({ number: "21", system: "D01", path: parent });
    expect(pairAction({ oldPath: "JDex/21.11 Default.md", newPath: "JDex/21.11 Renamed.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
  });

  it("reports losing an ID prefix, preserves the original number, and ignores a plain title rename", () => {
    const index = indexOf([], ["21.11 Before"]);
    expect(pairAction({ oldPath: "JDex/21.11 Before.md", newPath: "JDex/Before.md", isFolder: false }, index, settings)).toEqual({ type: "unnumbered", oldId: "21.11" });
    expect(pairAction({ oldPath: "JDex/21.11 Before.md", newPath: "JDex/D01.21.11 Before.md", isFolder: false }, index, settings)).toEqual({ type: "renumbered", oldId: "21.11", newId: "D01.21.11" });
    expect(pairAction({ oldPath: "JDex/Unnumbered.md", newPath: "JDex/Other.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
  });
});
