import { describe, expect, it } from "vitest";
import { detectFolders, fillEmpty, relativeTo } from "../src/jd/detect";
import { FOLDERS, JDEX, REPORTS, TEMPLATES } from "./fixtures";

describe("relativeTo", () => {
  it("handles the empty root, the root itself and paths outside", () => {
    expect(relativeTo("", "a/b")).toBe("a/b");
    expect(relativeTo("a", "a")).toBe("");
    expect(relativeTo("a", "a/b/c")).toBe("b/c");
    expect(relativeTo("a", "ab/c")).toBeNull();
    expect(relativeTo("/a/", "a/b")).toBe("b");
  });
});

describe("detectFolders", () => {
  it("finds 00.00, 00.02 and 00.03 under 00-09/00 at the vault root", () => {
    expect(detectFolders(FOLDERS)).toEqual({ jdex: JDEX, reports: REPORTS, templates: TEMPLATES });
  });

  it("respects the system root", () => {
    const nested = FOLDERS.map((p) => `Sistema/${p}`);
    expect(detectFolders(nested, "Sistema").jdex).toBe(`Sistema/${JDEX}`);
    expect(detectFolders(nested, "").jdex).toBeNull();
  });

  it("returns nulls when the management folders are missing", () => {
    expect(detectFolders(["10-19 Life/11 Money/11.11 Bank"])).toEqual({ jdex: null, reports: null, templates: null });
    expect(detectFolders([])).toEqual({ jdex: null, reports: null, templates: null });
  });

  it("ignores 00.xx folders outside 00-09/00", () => {
    expect(detectFolders(["10-19 Life/00 Odd/00.00 Nope", "00-09 Sys/01 Other/00.00 Nope"]).jdex).toBeNull();
  });
});

describe("fillEmpty", () => {
  it("fills only empty fields and never overwrites", () => {
    const current = { jdexFolder: "Mi JDex", reportsFolder: "", templatesFolder: "" };
    const { next, changed } = fillEmpty(current, { jdex: JDEX, reports: REPORTS, templates: null });
    expect(changed).toBe(true);
    expect(next).toEqual({ jdexFolder: "Mi JDex", reportsFolder: REPORTS, templatesFolder: "" });
    expect(current.reportsFolder).toBe("");
  });

  it("reports no change when nothing applies", () => {
    const current = { jdexFolder: "", reportsFolder: "", templatesFolder: "" };
    expect(fillEmpty(current, { jdex: null, reports: null, templates: null }).changed).toBe(false);
  });
});
